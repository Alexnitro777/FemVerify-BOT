import { Client, EmbedBuilder, Guild, TextChannel } from 'discord.js';
import { config } from './config';
import { Application } from './types';
import {
  listPendingApplications,
  claimApplication,
  updateApplication,
} from './storage';
import {
  buildDmEmbed,
  buildResolvedEmbed,
  buildAutoClosedButtonRow,
  postDecisionMessage,
} from './ui';

const APPLICATION_TTL_MS = 2 * 24 * 60 * 60_000;

const SWEEP_INTERVAL_MS = Math.min(
  5 * 60_000,
  Math.max(10_000, Math.floor(APPLICATION_TTL_MS / 4)),
);

const AUTO_CLOSE_REASON = 'Переподайте анкету на верификацию';
const AUTO_CLOSE_LABEL = 'Закрыто автоматически';
const AUTO_CLOSE_COLOR = 0x99aab5;

async function deleteQuestionChannel(guild: Guild, app: Application): Promise<void> {
  if (!app.questionChannelId) return;
  const channel = await guild.channels.fetch(app.questionChannelId).catch(() => null);
  await channel
    ?.delete('Автозакрытие анкеты: истёк срок рассмотрения')
    .catch((e) => {
      console.error('[applicationCleanup] не удалось удалить канал вопроса', e);
      return null;
    });
  updateApplication(app.userId, { questionChannelId: undefined });
}

async function markReviewMessageResolved(
  client: Client,
  reviewMessageUrl: string | undefined,
  reviewerId: string,
): Promise<void> {
  if (!reviewMessageUrl) return;
  const parsed = reviewMessageUrl.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!parsed) return;

  const [, , channelId, messageId] = parsed;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const msg = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
  if (!msg || !msg.embeds[0]) return;

  const resolved = buildResolvedEmbed(
    EmbedBuilder.from(msg.embeds[0]),
    AUTO_CLOSE_LABEL,
    AUTO_CLOSE_COLOR,
    reviewerId,
  );
  await msg
    .edit({ embeds: [resolved], components: [buildAutoClosedButtonRow()] })
    .catch((e) => {
      console.error('[applicationCleanup] не удалось обновить сообщение ревью', e);
      return null;
    });
}

async function closeExpiredApplication(
  client: Client,
  guild: Guild,
  app: Application,
): Promise<void> {
  const reviewerId = client.user?.id ?? config.clientId;

  const claimed = claimApplication(app.userId, 'expired', reviewerId, AUTO_CLOSE_REASON);
  if (!claimed) return;

  await deleteQuestionChannel(guild, app);
  await markReviewMessageResolved(client, app.reviewMessageUrl, reviewerId);

  const member = await guild.members.fetch(app.userId).catch(() => null);
  await member
    ?.send({
      embeds: [buildDmEmbed('⌛ Анкета закрыта', `${AUTO_CLOSE_REASON}.`, AUTO_CLOSE_COLOR)],
    })
    .catch(() => null);

  await postDecisionMessage(client, config.channels.decisions, 'application', {
    label: AUTO_CLOSE_LABEL,
    color: AUTO_CLOSE_COLOR,
    reviewerId,
    targetUserId: app.userId,
    reviewMessageUrl: app.reviewMessageUrl,
    reason: { title: 'Причина', text: AUTO_CLOSE_REASON },
    number: app.number,
  });
}

async function sweep(client: Client): Promise<void> {
  const apps = listPendingApplications();
  if (apps.length === 0) return;

  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return;

  const now = Date.now();

  for (const app of apps) {
    if (now - app.submittedAt < APPLICATION_TTL_MS) continue;
    await closeExpiredApplication(client, guild, app).catch((e) =>
      console.error('[applicationCleanup] не удалось закрыть анкету', app.userId, e),
    );
  }
}

export function registerApplicationCleanup(client: Client): void {
  const run = (): void => {
    void sweep(client).catch((e) =>
      console.error('[applicationCleanup] ошибка прохода', e),
    );
  };

  client.once('clientReady', () => {
    console.log(
      `[applicationCleanup] включено: TTL=${Math.round(APPLICATION_TTL_MS / 3_600_000)} ч, ` +
        `проверка каждые ${Math.round(SWEEP_INTERVAL_MS / 1000)} с`,
    );
    run();
    setInterval(run, SWEEP_INTERVAL_MS);
  });
}
