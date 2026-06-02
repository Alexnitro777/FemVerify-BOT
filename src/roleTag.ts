import { Client, EmbedBuilder, GuildMember, TextChannel, User } from 'discord.js';
import { config } from './config';

export interface PrimaryGuildInfo {
  identityGuildId: string | null;
  identityEnabled: boolean | null;
  tag: string | null;
}

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

function infoIsOurTag(pg: PrimaryGuildInfo | null): boolean {
  if (!pg) return false;
  return pg.identityEnabled === true && pg.identityGuildId === config.guildId;
}

export function hasServerTag(user: User): boolean {
  return infoIsOurTag(getPrimaryGuild(user));
}

function rawUserHasServerTag(rawUser: Record<string, unknown> | undefined | null): boolean {
  if (!rawUser) return false;
  const pg = (rawUser.primary_guild ?? rawUser.primaryGuild) as
    | Record<string, unknown>
    | null
    | undefined;
  return infoIsOurTag(normalizePrimaryGuild(pg));
}

async function sendTagLog(member: GuildMember, action: 'added' | 'removed'): Promise<void> {
  const channelId = config.channels.tagLog;
  if (!channelId) return;
  const roleId = config.roles.roleTag;

  try {
    const channel =
      member.guild.channels.cache.get(channelId) ??
      (await member.guild.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased()) return;

    const added = action === 'added';

    const embed = new EmbedBuilder()
      .setColor(added ? 0x57f287 : 0xed4245)
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL() })
      .setTitle(added ? '🏷️ Выдана роль за тег сервера' : '🏷️ Снята роль за тег сервера')
      .setDescription(`<@${member.id}>`)
      .addFields(
        { name: 'Участник', value: `${member.user.tag}\n\`${member.id}\``, inline: true },
        { name: 'Роль', value: roleId ? `<@&${roleId}>` : '—', inline: true },
        {
          name: 'Действие',
          value: added ? 'Участник надел тег сервера' : 'Участник снял тег сервера',
          inline: false,
        },
      )
      .setFooter({ text: 'Тег сервера' })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    console.error(`[roleTag] не удалось отправить лог для ${member.id}:`, err);
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

async function applyTagRole(member: GuildMember, shouldHave: boolean): Promise<void> {
  const roleId = config.roles.roleTag;
  if (!roleId) return;
  if (member.user.bot) return;
  if (member.guild.id !== config.guildId) return;

  const key = `${member.guild.id}:${member.id}`;
  await runExclusive(key, async () => {
    const fresh = member.guild.members.cache.get(member.id) ?? member;
    const hasRole = fresh.roles.cache.has(roleId);

    try {
      if (shouldHave && !hasRole) {
        await fresh.roles.add(roleId, 'Надел тег сервера');
        console.log(`[roleTag] выдана роль ${fresh.user.tag} (${fresh.id})`);
        await sendTagLog(fresh, 'added');
      } else if (!shouldHave && hasRole) {
        await fresh.roles.remove(roleId, 'Снял тег сервера');
        console.log(`[roleTag] снята роль ${fresh.user.tag} (${fresh.id})`);
        await sendTagLog(fresh, 'removed');
      }
    } catch (err) {
      console.error(`[roleTag] не удалось обновить роль для ${fresh.id}:`, err);
    }
  });
}

export async function syncMemberTagRole(member: GuildMember): Promise<void> {
  await applyTagRole(member, hasServerTag(member.user));
}

export async function syncAllTagRoles(client: Client): Promise<void> {
  if (!config.roles.roleTag) return;

  const guild =
    client.guilds.cache.get(config.guildId) ??
    (await client.guilds.fetch(config.guildId).catch(() => null));
  if (!guild) {
    console.warn('[roleTag] гильдия из конфига недоступна — пропускаем стартовую синхронизацию.');
    return;
  }

  try {
    const members = await guild.members.fetch();
    for (const member of members.values()) {
      await syncMemberTagRole(member);
    }
    console.log(`[roleTag] стартовая синхронизация завершена (${members.size} участников).`);
  } catch (err) {
    console.error('[roleTag] стартовая синхронизация не удалась:', err);
  }
}

export function registerTagRoleEvents(client: Client): void {
  if (!config.roles.roleTag) {
    console.warn(
      '[roleTag] roles.roleTag не задан в конфиге — автовыдача роли за тег сервера отключена.',
    );
    return;
  }

  client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== config.guildId) return;
    const m = member.partial ? await member.fetch().catch(() => null) : member;
    if (m) await syncMemberTagRole(m);
  });

  client.on('guildMemberUpdate', async (_oldMember, newMember) => {
    if (newMember.guild.id !== config.guildId) return;
    const m = newMember.partial ? await newMember.fetch().catch(() => null) : newMember;
    if (m) await syncMemberTagRole(m);
  });

  client.on('userUpdate', async (_oldUser, newUser) => {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    const member = await guild.members.fetch(newUser.id).catch(() => null);
    if (member) await syncMemberTagRole(member);
  });

  client.on('raw', async (packet: { t?: string; d?: Record<string, unknown> }) => {
    if (!packet || packet.t !== 'GUILD_MEMBER_UPDATE') return;
    const data = packet.d;
    if (!data || data.guild_id !== config.guildId) return;
    const rawUser = data.user as Record<string, unknown> | undefined;
    const userId = rawUser?.id as string | undefined;
    if (!userId) return;

    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;

    await applyTagRole(member, rawUserHasServerTag(rawUser));
  });
}
