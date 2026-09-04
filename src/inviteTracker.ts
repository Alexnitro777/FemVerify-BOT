import { Client, Collection, Events, Guild, Invite, PermissionFlagsBits } from 'discord.js';
import { saveJoinMethod } from './storage';
import { mapWithConcurrency, logSettledFailures } from './concurrency';

interface CachedInvite {
  uses: number;
  inviterId: string | null;
}

interface DeletedInvite {
  inviterId: string | null;
  deletedAt: number;
}

interface GuildInviteState {
  invites: Map<string, CachedInvite>;
  recentlyDeleted: Map<string, DeletedInvite>;
  vanityUses: number | null;
  credits: Map<string, { inviterId: string | null; left: number; expiresAt: number }>;
}

const guildStates = new Map<string, GuildInviteState>();

function stateFor(guildId: string): GuildInviteState {
  let state = guildStates.get(guildId);
  if (!state) {
    state = {
      invites: new Map(),
      recentlyDeleted: new Map(),
      vanityUses: null,
      credits: new Map(),
    };
    guildStates.set(guildId, state);
  }
  return state;
}

const UNKNOWN = 'Неизвестно';
const VANITY = 'По vanity-ссылке';
const TRAVEL = 'Путешествие';

const DELETED_WINDOW_MS = 10_000;
const CREDIT_TTL_MS = 60_000;
const RECACHE_INTERVAL_MS = 20 * 60 * 1000;
const CACHE_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 1_000;
const GUILD_CACHE_CONCURRENCY = 5;

const locks = new Map<string, Promise<unknown>>();

function runExclusive<T>(guildId: string, task: () => Promise<T>): Promise<T> {
  const prev = locks.get(guildId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  locks.set(
    guildId,
    next.catch(() => undefined),
  );
  return next;
}

function snapshotInvites(guildId: string, invites: Collection<string, Invite>): void {
  const state = stateFor(guildId);
  state.invites.clear();
  for (const invite of invites.values()) {
    state.invites.set(invite.code, {
      uses: invite.uses ?? 0,
      inviterId: invite.inviterId ?? null,
    });
  }
}

function hasManageGuild(guild: Guild): boolean {
  const me = guild.members.me;
  return me ? me.permissions.has(PermissionFlagsBits.ManageGuild) : true;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms (${label})`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function formatInviter(code: string, inviterId: string | null, prefix = 'Инвайт'): string {
  return inviterId ? `<@${inviterId}>` : `${prefix}: ${code}`;
}

async function cacheGuildInvites(guild: Guild): Promise<void> {
  const state = stateFor(guild.id);

  if (!hasManageGuild(guild)) {
    console.warn(
      `[inviteTracker] ${guild.name}: нет права «Управление сервером» — способ входа будет «Неизвестно» для всех.`,
    );
    return;
  }

  const wantsVanity = guild.features.includes('VANITY_URL');
  const [invitesResult, vanityResult] = await Promise.allSettled([
    withTimeout(guild.invites.fetch(), CACHE_TIMEOUT_MS, 'invites.fetch'),
    wantsVanity
      ? withTimeout(guild.fetchVanityData(), CACHE_TIMEOUT_MS, 'fetchVanityData')
      : Promise.resolve(null),
  ]);

  if (invitesResult.status === 'fulfilled') {
    snapshotInvites(guild.id, invitesResult.value);
    console.log(`[inviteTracker] ${guild.name}: закэшировано инвайтов: ${state.invites.size}`);
  } else {
    console.warn(
      `[inviteTracker] ${guild.name}: не удалось получить инвайты. Способ входа будет «Неизвестно».`,
      invitesResult.reason,
    );
  }

  state.vanityUses =
    vanityResult.status === 'fulfilled' && typeof vanityResult.value?.uses === 'number'
      ? vanityResult.value.uses
      : null;
}

async function detectJoinMethod(guild: Guild): Promise<string> {
  const state = stateFor(guild.id);
  const now = Date.now();

  for (const [code, entry] of state.recentlyDeleted) {
    if (now - entry.deletedAt > DELETED_WINDOW_MS) state.recentlyDeleted.delete(code);
  }

  for (const [code, credit] of state.credits) {
    if (credit.left <= 0 || now > credit.expiresAt) state.credits.delete(code);
  }

  let fresh: Collection<string, Invite>;
  try {
    fresh = await guild.invites.fetch({ cache: false });
  } catch (err: any) {
    const msg = err?.message || 'ошибка';
    return `Ошибка API: ${msg.substring(0, 30)}`;
  }

  const snapshotSize = state.invites.size;

  if (snapshotSize === 0) {
    snapshotInvites(guild.id, fresh);
    console.warn(
      `[inviteTracker] ${guild.name}: снапшот был пустым — не можем определить способ входа. Снапшот обновлён.`,
    );
    return UNKNOWN;
  }

  const strong = new Map<string, string | null>();
  const weak = new Map<string, string | null>();
  const grewCodes: string[] = [];

  for (const invite of fresh.values()) {
    const prev = state.invites.get(invite.code);
    const uses = invite.uses ?? 0;
    if (prev) {
      if (uses > prev.uses) {
        const inviterId = invite.inviterId ?? prev.inviterId;
        strong.set(invite.code, inviterId);
        grewCodes.push(invite.code);
        const jump = uses - prev.uses;
        if (jump > 1) {
          state.credits.set(invite.code, {
            inviterId,
            left: jump - 1,
            expiresAt: now + CREDIT_TTL_MS,
          });
        }
      }
    } else if (uses > 0) {
      weak.set(invite.code, invite.inviterId ?? null);
    }
  }

  for (const [code, prev] of state.invites) {
    if (!fresh.has(code)) strong.set(code, prev.inviterId);
  }

  const consumedDeleted: string[] = [];
  for (const [code, entry] of state.recentlyDeleted) {
    if (now - entry.deletedAt <= DELETED_WINDOW_MS) {
      strong.set(code, entry.inviterId);
      consumedDeleted.push(code);
    }
  }

  snapshotInvites(guild.id, fresh);
  for (const code of consumedDeleted) state.recentlyDeleted.delete(code);

  console.log(
    `[inviteTracker] ${guild.name}: снапшот ${snapshotSize}→${state.invites.size}, ` +
      `выросли=[${grewCodes.join(', ')}], удалённых-в-окне=[${consumedDeleted.join(', ')}], ` +
      `кандидатов=${strong.size} (слабых=${weak.size})`,
  );

  if (strong.size === 1) {
    const code = strong.keys().next().value as string;
    return formatInviter(code, strong.get(code) ?? null);
  }

  if (strong.size > 1) {
    const codes = [...strong.keys()].join(', ');
    console.warn(
      `[inviteTracker] ${guild.name}: неоднозначно — изменилось несколько инвайтов: [${codes}].`,
    );
    return `Несколько инвайтов: ${codes}`;
  }

  if (state.credits.size === 1) {
    const code = state.credits.keys().next().value as string;
    const credit = state.credits.get(code)!;
    credit.left -= 1;
    if (credit.left <= 0) state.credits.delete(code);
    console.log(`[inviteTracker] ${guild.name}: списан кредит инвайта ${code}`);
    return formatInviter(code, credit.inviterId);
  }

  if (guild.features.includes('VANITY_URL')) {
    try {
      const vanity = await withTimeout(guild.fetchVanityData(), 2_000, 'fetchVanityData');
      const uses = typeof vanity.uses === 'number' ? vanity.uses : null;
      const prevVanity = state.vanityUses;
      state.vanityUses = uses;
      if (prevVanity !== null && uses !== null && uses > prevVanity) {
        return vanity.code ? `https://discord.gg/${vanity.code}` : VANITY;
      }
    } catch (err: any) {
      console.log(`[inviteTracker] ${guild.name}: vanity-данные недоступны (${err?.message})`);
    }
  }

  if (weak.size === 1) {
    const code = weak.keys().next().value as string;
    return formatInviter(code, weak.get(code) ?? null, 'Новый инвайт');
  }

  if (weak.size > 1) {
    const codes = [...weak.keys()].join(', ');
    console.warn(
      `[inviteTracker] ${guild.name}: неоднозначно — несколько ранее неизвестных инвайтов: [${codes}].`,
    );
    return `Несколько новых: ${codes}`;
  }

  return TRAVEL;
}

export function detectJoinMethodLocked(guild: Guild): Promise<string> {
  return runExclusive(guild.id, () => detectJoinMethod(guild));
}

export async function detectJoinMethodWithRetry(guild: Guild): Promise<string> {
  const first = await detectJoinMethodLocked(guild);
  if (first !== TRAVEL && first !== UNKNOWN) return first;

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  const second = await detectJoinMethodLocked(guild);
  return second === TRAVEL || second === UNKNOWN ? first : second;
}

export async function resolveJoinMethod(guild: Guild, userId: string): Promise<void> {
  const method = await detectJoinMethodWithRetry(guild);
  await saveJoinMethod(guild.id, userId, method);
  console.log(`[inviteTracker] ${userId} — способ входа: ${method}`);
}

export function registerInviteTracker(client: Client): void {
  client.once(Events.ClientReady, async () => {
    const guilds = [...client.guilds.cache.values()];
    console.log(`[inviteTracker] начинаем кэширование для ${guilds.length} серверов...`);
    logSettledFailures(
      'inviteTracker',
      await mapWithConcurrency(guilds, GUILD_CACHE_CONCURRENCY, (guild) =>
        runExclusive(guild.id, () => cacheGuildInvites(guild)),
      ),
    );

    setInterval(() => {
      void (async () => {
        logSettledFailures(
          'inviteTracker',
          await mapWithConcurrency(
            [...client.guilds.cache.values()],
            GUILD_CACHE_CONCURRENCY,
            (guild) => runExclusive(guild.id, () => cacheGuildInvites(guild)),
          ),
        );
      })();
    }, RECACHE_INTERVAL_MS);
  });

  client.on(Events.GuildCreate, (guild) => {
    void runExclusive(guild.id, () => cacheGuildInvites(guild)).catch((err) =>
      console.error('[inviteTracker] ошибка кэширования инвайтов новой гильдии', err),
    );
  });

  client.on(Events.InviteCreate, (invite) => {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    void runExclusive(guildId, async () => {
      stateFor(guildId).invites.set(invite.code, {
        uses: invite.uses ?? 0,
        inviterId: invite.inviterId ?? null,
      });
    });
  });

  client.on(Events.InviteDelete, (invite) => {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    void runExclusive(guildId, async () => {
      const state = stateFor(guildId);
      const entry = state.invites.get(invite.code);
      if (entry) {
        state.recentlyDeleted.set(invite.code, {
          inviterId: entry.inviterId,
          deletedAt: Date.now(),
        });
      }
      state.invites.delete(invite.code);
    });
  });
}
