import { Client, GuildMember, User } from 'discord.js';
import { config } from './config';

/**
 * Данные о "теге сервера" (Server Tag / primary guild) пользователя.
 * Discord отдаёт их в объекте user.primary_guild. В зависимости от версии
 * discord.js поле может называться camelCase (primaryGuild) или приходить
 * сырым snake_case — поэтому читаем максимально устойчиво.
 */
export interface PrimaryGuildInfo {
  identityGuildId: string | null;
  identityEnabled: boolean | null;
  tag: string | null;
}

/** Достаёт информацию о теге сервера у пользователя (или null, если её нет). */
export function getPrimaryGuild(user: User): PrimaryGuildInfo | null {
  const anyUser = user as unknown as {
    primaryGuild?: Record<string, unknown> | null;
    primary_guild?: Record<string, unknown> | null;
  };
  const pg = anyUser.primaryGuild ?? anyUser.primary_guild ?? null;
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

/**
 * true, если пользователь сейчас носит тег ИМЕННО нашего сервера
 * (guildId из конфига) и тег включён.
 */
export function hasServerTag(user: User): boolean {
  const pg = getPrimaryGuild(user);
  if (!pg) return false;
  return pg.identityEnabled === true && pg.identityGuildId === config.guildId;
}

/**
 * Синхронизирует роль за тег сервера у одного участника:
 * выдаёт, если тег надет, и снимает, если тег убран.
 */
export async function syncMemberTagRole(member: GuildMember): Promise<void> {
  const roleId = config.roles.serverTag;
  if (!roleId) return;
  if (member.user.bot) return;
  if (member.guild.id !== config.guildId) return;

  const shouldHave = hasServerTag(member.user);
  const hasRole = member.roles.cache.has(roleId);

  try {
    if (shouldHave && !hasRole) {
      await member.roles.add(roleId, 'Носит тег сервера');
      console.log(`[serverTag] выдана роль ${member.user.tag} (${member.id})`);
    } else if (!shouldHave && hasRole) {
      await member.roles.remove(roleId, 'Снял тег сервера');
      console.log(`[serverTag] снята роль ${member.user.tag} (${member.id})`);
    }
  } catch (err) {
    console.error(`[serverTag] не удалось обновить роль для ${member.id}:`, err);
  }
}

/**
 * Полная синхронизация по всем участникам сервера. Запускается один раз
 * при старте, чтобы привести роли в актуальное состояние (на случай, если
 * кто-то надел/снял тег, пока бот был офлайн).
 */
export async function syncAllTagRoles(client: Client): Promise<void> {
  if (!config.roles.serverTag) return;

  const guild =
    client.guilds.cache.get(config.guildId) ??
    (await client.guilds.fetch(config.guildId).catch(() => null));
  if (!guild) {
    console.warn('[serverTag] гильдия из конфига недоступна — пропускаем стартовую синхронизацию.');
    return;
  }

  try {
    const members = await guild.members.fetch();
    for (const member of members.values()) {
      await syncMemberTagRole(member);
    }
    console.log(`[serverTag] стартовая синхронизация завершена (${members.size} участников).`);
  } catch (err) {
    console.error('[serverTag] стартовая синхронизация не удалась:', err);
  }
}

/**
 * Подписывает клиент на события, по которым нужно пересчитывать роль за тег:
 * вход участника, изменение участника и изменение пользователя.
 */
export function registerTagRoleEvents(client: Client): void {
  if (!config.roles.serverTag) {
    console.warn(
      '[serverTag] roles.serverTag не задан в конфиге — автовыдача роли за тег сервера отключена.',
    );
    return;
  }

  // Новый участник: сразу проверяем тег.
  client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== config.guildId) return;
    const m = member.partial ? await member.fetch().catch(() => null) : member;
    if (m) await syncMemberTagRole(m);
  });

  // Участник изменился (в т.ч. сменился объект user с тегом).
  client.on('guildMemberUpdate', async (_oldMember, newMember) => {
    if (newMember.guild.id !== config.guildId) return;
    const m = newMember.partial ? await newMember.fetch().catch(() => null) : newMember;
    if (m) await syncMemberTagRole(m);
  });

  // Пользователь изменился глобально — находим его участником нашей гильдии.
  client.on('userUpdate', async (_oldUser, newUser) => {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    const member = await guild.members.fetch(newUser.id).catch(() => null);
    if (member) await syncMemberTagRole(member);
  });
}
