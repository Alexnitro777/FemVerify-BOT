import { Client, Collection, Guild, Invite } from 'discord.js';
import { saveJoinMethod } from './storage';

interface CachedInvite {
  uses: number;
  inviterId: string | null;
}

interface GuildInviteState {
  invites: Map<string, CachedInvite>;
  vanityUses: number | null;
}

const guildStates = new Map<string, GuildInviteState>();

function stateFor(guildId: string): GuildInviteState {
  let state = guildStates.get(guildId);
  if (!state) {
    state = { invites: new Map(), vanityUses: null };
    guildStates.set(guildId, state);
  }
  return state;
}

const UNKNOWN = 'Неизвестно';
const VANITY = 'По vanity-ссылке';

const locks = new Map<string, Promise<void>>();

function runExclusive(guildId: string, task: () => Promise<void>): Promise<void> {
  const prev = locks.get(guildId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  locks.set(guildId, next.catch(() => undefined));
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

async function cacheGuildInvites(guild: Guild): Promise<void> {
  const state = stateFor(guild.id);
  try {
    const invites = await guild.invites.fetch();
    snapshotInvites(guild.id, invites);
    console.log(`[inviteTracker] ${guild.name}: закэшировано инвайтов: ${state.invites.size}`);
  } catch (err) {
    console.warn(
      `[inviteTracker] ${guild.name}: не удалось получить инвайты — нужно право «Управление сервером». Способ входа будет «Неизвестно».`,
      err,
    );
  }

  try {
    const vanity = await guild.fetchVanityData();
    state.vanityUses = typeof vanity.uses === 'number' ? vanity.uses : null;
  } catch {
    state.vanityUses = null;
  }
}

async function detectJoinMethod(guild: Guild): Promise<string> {
  const state = stateFor(guild.id);
  let fresh: Collection<string, Invite>;
  try {
    fresh = await guild.invites.fetch();
  } catch {
    return UNKNOWN;
  }

  let inviterId: string | null | undefined;

  for (const invite of fresh.values()) {
    const prev = state.invites.get(invite.code);
    const uses = invite.uses ?? 0;
    if (prev && uses > prev.uses) {
      inviterId = invite.inviterId ?? prev.inviterId;
      break;
    }
  }

  if (inviterId === undefined) {
    const missing: CachedInvite[] = [];
    for (const [code, prev] of state.invites) {
      if (!fresh.has(code)) missing.push(prev);
    }
    if (missing.length === 1) {
      inviterId = missing[0].inviterId;
    }
  }

  snapshotInvites(guild.id, fresh);

  if (inviterId !== undefined) {
    return inviterId ? `<@${inviterId}>` : UNKNOWN;
  }

  try {
    const vanity = await guild.fetchVanityData();
    const uses = typeof vanity.uses === 'number' ? vanity.uses : null;
    const prevVanity = state.vanityUses;
    state.vanityUses = uses;
    if (prevVanity !== null && uses !== null && uses > prevVanity) {
      return vanity.code ? `https://discord.gg/${vanity.code}` : VANITY;
    }
  } catch {
  }

  return UNKNOWN;
}

export function registerInviteTracker(client: Client): void {
  client.once('clientReady', async () => {
    for (const guild of client.guilds.cache.values()) {
      await cacheGuildInvites(guild);
    }
  });

  client.on('guildCreate', (guild) => {
    void cacheGuildInvites(guild).catch((err) =>
      console.error('[inviteTracker] ошибка кэширования инвайтов новой гильдии', err),
    );
  });

  client.on('inviteCreate', (invite) => {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    void runExclusive(guildId, async () => {
      stateFor(guildId).invites.set(invite.code, {
        uses: invite.uses ?? 0,
        inviterId: invite.inviterId ?? null,
      });
    });
  });

  client.on('inviteDelete', (invite) => {
    const guildId = invite.guild?.id;
    if (!guildId) return;
    void runExclusive(guildId, async () => {
      stateFor(guildId).invites.delete(invite.code);
    });
  });

  client.on('guildMemberAdd', (member) => {
    if (member.user.bot) return;
    const guildId = member.guild.id;
    void runExclusive(guildId, async () => {
      const method = await detectJoinMethod(member.guild);
      await saveJoinMethod(guildId, member.id, method);
      console.log(`[inviteTracker] ${member.user.tag} (${member.id}) — способ входа: ${method}`);
    }).catch((err) => console.error('[inviteTracker] ошибка определения способа входа', err));
  });
}
