import { Client, EmbedBuilder, GuildMember, TextChannel, User } from 'discord.js';
import { config } from './config';

/**
 * Данные о "теге сервера" (Server Tag / primary guild) пользователя.
 * Discord отдаёт их в объекте user.primary_guild. В зависимости от версии
 * discord.js поле может называться camelCase (primaryGuild) или приходить
 * сырым snake_case (primary_guild) — поэтому читаем максимально устойчиво.
 */
export interface PrimaryGuildInfo {
  identityGuildId: string | null;
  identityEnabled: boolean | null;
  tag: string | null;
}

/** Нормализует сырой объект primary_guild / primaryGuild в PrimaryGuildInfo. */
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

/** Достаёт информацию о теге сервера у пользователя (или null, если её нет). */
export function getPrimaryGuild(user: User): PrimaryGuildInfo | null {
  const anyUser = user as unknown as {
    primaryGuild?: Record<string, unknown> | null;
    primary_guild?: Record<string, unknown> | null;
  };
  return normalizePrimaryGuild(anyUser.primaryGuild ?? anyUser.primary_guild ?? null);
}

/** true, если инфо о теге указывает на тег ИМЕННО нашего сервера и он включён. */
function infoIsOurTag(pg: PrimaryGuildInfo | null): boolean {
  if (!pg) return false;
  return pg.identityEnabled === true && pg.identityGuildId === config.guildId;
}

/**
 * true, если пользователь сейчас носит тег ИМЕННО нашего сервера
 * (guildId из конфига) и тег включён.
 */
export function hasServerTag(user: User): boolean {
  return infoIsOurTag(getPrimaryGuild(user));
}

/** То же самое, но по СЫРОМУ объекту user из gateway-пакета (актуальные данные). */
function rawUserHasServerTag(rawUser: Record<string, unknown> | undefined | null): boolean {
  if (!rawUser) return false;
  const pg = (rawUser.primary_guild ?? rawUser.primaryGuild) as
    | Record<string, unknown>
    | null
    | undefined;
  return infoIsOurTag(normalizePrimaryGuild(pg));
}

/** Отправляет embed-лог о выдаче/снятии роли за тег в канал channels.tagLog (если задан). */
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
    const tag = getPrimaryGuild(member.user)?.tag ?? null;

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
      .setFooter({ text: added && tag ? `Тег: ${tag}` : 'Тег сервера' })
      .setTimestamp();

    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    console.error(`[roleTag] не удалось отправить лог для ${member.id}:`, err);
  }
}

/** Выдаёт или снимает роль roleTag у участника в зависимости от shouldHave. */
async function applyTagRole(member: GuildMember, shouldHave: boolean): Promise<void> {
  const roleId = config.roles.roleTag;
  if (!roleId) return;
  if (member.user.bot) return;
  if (member.guild.id !== config.guildId) return;

  const hasRole = member.roles.cache.has(roleId);

  try {
    if (shouldHave && !hasRole) {
      await member.roles.add(roleId, 'Надел тег сервера');
      console.log(`[roleTag] выдана роль ${member.user.tag} (${member.id})`);
      await sendTagLog(member, 'added');
    } else if (!shouldHave && hasRole) {
      await member.roles.remove(roleId, 'Снял тег сервера');
      console.log(`[roleTag] снята роль ${member.user.tag} (${member.id})`);
      await sendTagLog(member, 'removed');
    }
  } catch (err) {
    console.error(`[roleTag] не удалось обновить роль для ${member.id}:`, err);
  }
}

/**
 * Синхронизирует роль за тег сервера по текущему состоянию участника.
 */
export async function syncMemberTagRole(member: GuildMember): Promise<void> {
  await applyTagRole(member, hasServerTag(member.user));
}

/**
 * Полная синхронизация по всем участникам сервера. Запускается один раз
 * при старте, чтобы привести роли в актуальное состояние (на случай, если
 * кто-то надел/снял тег, пока бот был офлайн).
 */
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

/**
 * Подписывает клиент на события, по которым нужно пересчитывать роль за тег.
 */
export function registerTagRoleEvents(client: Client): void {
  if (!config.roles.roleTag) {
    console.warn(
      '[roleTag] roles.roleTag не задан в конфиге — автовыдача роли за тег сервера отключена.',
    );
    return;
  }

  // Новый участник: сразу проверяем тег.
  client.on('guildMemberAdd', async (member) => {
    if (member.guild.id !== config.guildId) return;
    const m = member.partial ? await member.fetch().catch(() => null) : member;
    if (m) await syncMemberTagRole(m);
  });

  // Участник обновил профиль (ник, тег и т.д.) — высокоуровневое событие.
  client.on('guildMemberUpdate', async (_oldMember, newMember) => {
    if (newMember.guild.id !== config.guildId) return;
    const m = newMember.partial ? await newMember.fetch().catch(() => null) : newMember;
    if (m) await syncMemberTagRole(m);
  });

  // Пользователь изменился глобально (ник/аватар/тег) — находим его участником.
  client.on('userUpdate', async (_oldUser, newUser) => {
    const guild = client.guilds.cache.get(config.guildId);
    if (!guild) return;
    const member = await guild.members.fetch(newUser.id).catch(() => null);
    if (member) await syncMemberTagRole(member);
  });

  // Низкоуровневый надёжный fallback: сырое gateway-событие обновления участника.
  // Читаем АКТУАЛЬНЫЙ тег прямо из пакета Discord (d.user.primary_guild) — это работает
  // даже если версия discord.js не разбирает primary_guild на высоком уровне.
  // Операции идемпотентны: повторный вызов с тем же состоянием ничего не меняет.
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
