import { Client, Guild, GuildMember, PartialGuildMember } from 'discord.js';
import { config } from './config';
import {
  getApplication,
  getAppeal,
  markApplicationLeft,
  markAppealLeft,
} from './storage';
import { buildLeftServerButtonRow } from './ui';

interface ParsedMessageUrl {
  guildId: string;
  channelId: string;
  messageId: string;
}

/** Разбирает ссылку на сообщение Discord вида .../channels/<guild>/<channel>/<message>. */
function parseMessageUrl(url: string): ParsedMessageUrl | null {
  const m = url.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

/**
 * Заменяет все кнопки исходного сообщения заявки/апелляции на единственную серую
 * неактивную кнопку «Покинул сервер».
 */
async function markReviewMessageLeft(
  guild: Guild,
  reviewMessageUrl: string | undefined,
): Promise<void> {
  if (!reviewMessageUrl) return;
  const parsed = parseMessageUrl(reviewMessageUrl);
  if (!parsed) return;

  const channel = await guild.channels.fetch(parsed.channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const message = await channel.messages.fetch(parsed.messageId).catch(() => null);
  if (!message) return;

  await message
    .edit({ components: [buildLeftServerButtonRow()] })
    .catch((e) => console.error('[leaveCleanup] failed to edit review message', e));
}

/** Удаляет приватный канал-вопрос участника, если он создавался. */
async function deleteQuestionChannel(
  guild: Guild,
  channelId: string | undefined,
): Promise<void> {
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  await channel
    ?.delete('Участник покинул сервер с неразобранной заявкой')
    .catch((e) => console.error('[leaveCleanup] failed to delete question channel', e));
}

/**
 * Обрабатывает выход участника: если у него осталась неразобранная (pending)
 * анкета или апелляция — гасит все кнопки, ставит серую метку «Покинул сервер»,
 * а для анкеты дополнительно удаляет приватный канал-вопрос.
 */
async function handleMemberRemove(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  // Реагируем только на наш сервер из конфига.
  if (member.guild?.id !== config.guildId) return;

  const guild = member.guild;
  const userId = member.id;

  // --- Неразобранная анкета верификации ---
  const app = getApplication(userId);
  if (app && app.status === 'pending' && markApplicationLeft(userId)) {
    await markReviewMessageLeft(guild, app.reviewMessageUrl);
    await deleteQuestionChannel(guild, app.questionChannelId);
  }

  // --- Неразобранная апелляция ---
  const appeal = getAppeal(userId);
  if (appeal && appeal.status === 'pending' && markAppealLeft(userId)) {
    await markReviewMessageLeft(guild, appeal.reviewMessageUrl);
  }
}

/**
 * Подписка на выход участников с сервера.
 * Требует интента GuildMembers и Partials.GuildMember (уже включены в index.ts).
 */
export function registerLeaveCleanupEvents(client: Client): void {
  client.on('guildMemberRemove', (member) => {
    void handleMemberRemove(member).catch((e) =>
      console.error('[leaveCleanup] handler failed', e),
    );
  });
}
