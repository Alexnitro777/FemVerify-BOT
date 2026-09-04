import { Client, EmbedBuilder, Events, Guild, TextChannel, User } from 'discord.js';
import { GuildConfig } from './types';
import { getGuildConfig } from './guildConfig';
import { mapWithConcurrency, logSettledFailures } from './concurrency';

export interface PrimaryGuildInfo {
  identityGuildId: string | null;
  identityEnabled: boolean | null;
  tag: string | null;
}

const SYNC_CONCURRENCY = 5;

function normalizePrimaryGuild(pg: Record<string, unknown> | null | undefined): PrimaryGuildInfo | null {
  if (!pg) return null;
  const identityGuildId =
    (pg.identityGuildId as string | undefined) ??
    (pg.identity_guild_id as string | undefined) ??
    null;
  const identityEnabled =
    (pg.identityEnabled as boolean | undefined) ??
    (pg.identity_enabled as boolean | undefined) ??
    null;
  const tag = (pg.tag as string | undefined) ?? null;
  return { identityGuildId, identityEnabled, tag };
}

export function getPrimaryGuild(user: User): PrimaryGuildInfo | null {
  const anyUser = user as unknown as {
    primaryGuild?: Record<string, unknown> | null;
    primary_guild?: Record<string, unknown> | null;
  };
  return normalizePrimaryGuild(anyUser.primaryGuild ?? anyUser.primary_guild ?? null);
}

function infoIsOurTag(pg: PrimaryGuildInfo | null, guildId: string): boolean {
  if (!pg) return false;
  return pg.identityEnabled === true && pg.identityGuildId === guildId;
}

export function hasServerTag(user: User, guildId: string): boolean {
  return infoIsOurTag(getPrimaryGuild(user), guildId);
}

function rawUserHasServerTag(
  rawUser: Record<string, unknown> | undefined | null,
  guildId: string,
): boolean {
  if (!rawUser) return false;
  const pg = (rawUser.primary_guild ?? rawUser.primaryGuild) as
    | Record<string, unknown>
    | null
    | undefined;
  return infoIsOurTag(normalizePrimaryGuild(pg), guildId);
}

async function sendTagLog(
  guild: Guild,
  userId: string,
  gc: GuildConfig,
  action: 'added' | 'removed',
): Promise<void> {
  const channelId = gc.channels.tagLog;
  if (!channelId) return;
  const roleId = gc.roles.roleTag;

  try {
    const channel =
      guild.channels.cache.get(channelId) ??
      (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return;

    const member =
      guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
    if (!member) return;

    const added = action === 'added';

    const embed = new EmbedBuilder()
      .setColor(added ? 0x57f287 : 0xed4245)
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setTitle(added ? '🏷️ Выдана роль за тег сервера' : '🏷️ Снята роль за тег сервера')
      .setDescription(`<@${userId}>`)
      .addFields(
        { name: 'Участник', value: `${member.user.tag}\n\`${userId}\``, inline: true },
        { name: 'Роль', value: roleId ? `<@&${roleId}>` : '—', inline: true },
        {
          name: 'Действие',
          value: added ? 'Участник надел тег сервера.' : 'Участник снял тег сервера.',
          inline: false,
        },
      )
      .setFooter({ text: 'Тег сервера' })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    console.error(`[roleTag] не удалось отправить лог для ${userId}:`, err);
  }
}

const tagRoleLocks = new Map<string, Promise<void>>();

function runExclusive(key: string, task: () => Promise<void>): Promise<void> {
  const prev = tagRoleLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  tagRoleLocks.set(key, next);
  void next.finally(() => {
    if (tagRoleLocks.get(key) === next) tagRoleLocks.delete(key);
  });
  return next;
}

async function applyTagRole(
  guild: Guild,
  userId: string,
  gc: GuildConfig,
  shouldHave: boolean,
): Promise<void> {
  const roleId = gc.roles.roleTag;
  if (!roleId) return;

  await runExclusive(`${guild.id}:${userId}`, async () => {
    const cached = guild.members.cache.get(userId);
    if (cached && cached.roles.cache.has(roleId) === shouldHave) return;

    try {
      if (shouldHave) {
        await guild.members.addRole({ user: userId, role: roleId, reason: 'Надел тег сервера' });
      } else {
        await guild.members.removeRole({ user: userId, role: roleId, reason: 'Снял тег сервера' });
      }
    } catch (err) {
      console.error(`[roleTag] не удалось обновить роль для ${userId}:`, err);
      return;
    }

    console.log(`[roleTag] ${shouldHave ? 'выдана' : 'снята'} роль ${userId}`);
    void sendTagLog(guild, userId, gc, shouldHave ? 'added' : 'removed');
  });
}

export async function syncAllTagRoles(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const gc = await getGuildConfig(guild.id);
    const roleId = gc?.roles.roleTag;
    if (!gc || !roleId) continue;

    try {
      const members = await guild.members.fetch();
      const pending = [...members.values()].filter((member) => {
        if (member.user.bot) return false;
        return hasServerTag(member.user, guild.id) !== member.roles.cache.has(roleId);
      });

      logSettledFailures(
        'roleTag',
        await mapWithConcurrency(pending, SYNC_CONCURRENCY, (member) =>
          applyTagRole(guild, member.id, gc, hasServerTag(member.user, guild.id)),
        ),
      );

      console.log(
        `[roleTag] синхронизация для ${guild.name} завершена ` +
          `(${members.size} участников, изменений: ${pending.length}).`,
      );
    } catch (err) {
      console.error(`[roleTag] синхронизация для ${guild.id} не удалась:`, err);
    }
  }
}

export function registerTagRoleEvents(client: Client): void {
  client.on(Events.Raw, (packet: { t?: string; d?: Record<string, unknown> }) => {
    if (!packet || packet.t !== 'GUILD_MEMBER_UPDATE') return;
    const data = packet.d;
    if (!data) return;

    const guildId = data.guild_id as string | undefined;
    if (!guildId) return;

    const rawUser = data.user as Record<string, unknown> | undefined;
    const userId = rawUser?.id as string | undefined;
    if (!userId) return;
    if (rawUser?.bot === true) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const shouldHave = rawUserHasServerTag(rawUser, guildId);
    const roles = data.roles;
    const packetRoles = Array.isArray(roles) ? (roles as string[]) : null;

    void (async () => {
      const gc = await getGuildConfig(guildId);
      const roleId = gc?.roles.roleTag;
      if (!gc || !roleId) return;
      if (packetRoles && packetRoles.includes(roleId) === shouldHave) return;

      await applyTagRole(guild, userId, gc, shouldHave);
    })().catch((err) => console.error('[roleTag] raw handler failed', err));
  });
}
