import { Client, Collection, Guild, Invite } from 'discord.js';
import { config } from './config';
import { saveJoinMethod } from './storage';

interface CachedInvite {
  uses: number;
  inviterId: string | null;
}

const inviteCache = new Map<string, CachedInvite>();
let vanityUses: number | null = null;

const UNKNOWN = 'Неизвестно';
const VANITY = 'По vanity-ссылке';

let lock: Promise<void> = Promise.resolve();

function runExclusive(task: () => Promise<void>): Promise<void> {
  const next = lock.catch(() => undefined).then(task);
  lock = next.catch(() => undefined);
  return next;
}

function snapshotInvites(invites: Collection<string, Invite>): void {
  inviteCache.clear();
  for (const invite of invites.values()) {
    inviteCache.set(invite.code, {
      uses: invite.uses ?? 0,
      inviterId: invite.inviterId ?? null,
    });
  }
}

async function cacheGuildInvites(guild: Guild): Promise<void> {
  try {
    const invites = await guild.invites.fetch();
    snapshotInvites(invites);
    console.log(`[inviteTracker] закэшировано инвайтов: ${inviteCache.size}`);
  } catch (err) {
    console.warn(
      '[inviteTracker] не удалось получить инвайты — нужно право «Управление сервером». Способ входа будет «Неизвестно».',
      err,
    );
  }

  try {
    const vanity = await guild.fetchVanityData();
    vanityUses = typeof vanity.uses === 'number' ? vanity.uses : null;
  } catch {
    vanityUses = null;
  }
}

async function detectJoinMethod(guild: Guild): Promise<string> {
  let fresh: Collection<string, Invite>;
  try {
    fresh = await guild.invites.fetch();
  } catch {
    return UNKNOWN;
  }

  let inviterId: string | null | undefined;

  for (const invite of fresh.values()) {
    const prev = inviteCache.get(invite.code);
    const uses = invite.uses ?? 0;
    if (prev && uses > prev.uses) {
      inviterId = invite.inviterId ?? prev.inviterId;
      break;
    }
  }

  if (inviterId === undefined) {
    const missing: CachedInvite[] = [];
    for (const [code, prev] of inviteCache) {
      if (!fresh.has(code)) missing.push(prev);
    }
    if (missing.length === 1) {
      inviterId = missing[0].inviterId;
    }
  }

  snapshotInvites(fresh);

  if (inviterId !== undefined) {
    return inviterId ? `<@${inviterId}>` : UNKNOWN;
  }

  try {
    const vanity = await guild.fetchVanityData();
    const uses = typeof vanity.uses === 'number' ? vanity.uses : null;
    const prevVanity = vanityUses;
    vanityUses = uses;
    if (prevVanity !== null && uses !== null && uses > prevVanity) {
      return vanity.code ? `https://discord.gg/${vanity.code}` : VANITY;
    }
  } catch {
  }

  return UNKNOWN;
}

export function registerInviteTracker(client: Client): void {
  client.once('clientReady', async () => {
    const guild =
      client.guilds.cache.get(config.guildId) ??
      (await client.guilds.fetch(config.guildId).catch(() => null));
    if (!guild) {
      console.warn('[inviteTracker] гильдия из конфига недоступна — трекинг инвайтов отключён.');
      return;
    }
    await cacheGuildInvites(guild);
  });

  client.on('inviteCreate', (invite) => {
    if (invite.guild?.id !== config.guildId) return;
    void runExclusive(async () => {
      inviteCache.set(invite.code, {
        uses: invite.uses ?? 0,
        inviterId: invite.inviterId ?? null,
      });
    });
  });

  client.on('inviteDelete', (invite) => {
    if (invite.guild?.id !== config.guildId) return;
    void runExclusive(async () => {
      inviteCache.delete(invite.code);
    });
  });

  client.on('guildMemberAdd', (member) => {
    if (member.guild.id !== config.guildId) return;
    if (member.user.bot) return;
    void runExclusive(async () => {
      const method = await detectJoinMethod(member.guild);
      saveJoinMethod(member.id, method);
      console.log(`[inviteTracker] ${member.user.tag} (${member.id}) — способ входа: ${method}`);
    }).catch((err) => console.error('[inviteTracker] ошибка определения способа входа', err));
  });
}
