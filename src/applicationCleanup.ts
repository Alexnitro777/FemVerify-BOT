import { Client, Events, Guild } from 'discord.js';
import { Application, GuildConfig } from './types';
import { getGuildConfig } from './guildConfig';
import { listExpiredPendingApplications, claimApplication } from './storage';
import {
  buildDmEmbed,
  buildAutoClosedButtonRow,
  postDecisionMessage,
  markReviewMessageResolved,
} from './ui';
import { deleteQuestionChannel } from './channels';
import { mapWithConcurrency, logSettledFailures } from './concurrency';

const APPLICATION_TTL_MS = 2 * 24 * 60 * 60_000;

const SWEEP_INTERVAL_MS = Math.min(
  5 * 60_000,
  Math.max(10_000, Math.floor(APPLICATION_TTL_MS / 4)),
);

const AUTO_CLOSE_REASON = 'Переподайте заявку на верификацию';
const AUTO_CLOSE_LABEL = 'Закрыто автоматически';
const AUTO_CLOSE_COLOR = 0x99aab5;
const CLOSE_CONCURRENCY = 5;

async function closeExpiredApplication(
  client: Client,
  guild: Guild,
  gc: GuildConfig,
  app: Application,
): Promise<void> {
  const reviewerId = client.user?.id ?? guild.id;

  const claimed = await claimApplication(
    app.guildId,
    app.userId,
    'expired',
    reviewerId,
    AUTO_CLOSE_REASON,
  );
  if (!claimed) return;

  const member =
    guild.members.cache.get(app.userId) ??
    (await guild.members.fetch(app.userId).catch(() => null));

  logSettledFailures(
    'applicationCleanup',
    await Promise.allSettled([
      deleteQuestionChannel(
        guild,
        claimed.questionChannelId,
        'Автозакрытие анкеты: истёк срок рассмотрения',
      ),
      markReviewMessageResolved(client, claimed.reviewMessageUrl, {
        kind: 'application',
        label: AUTO_CLOSE_LABEL,
        color: AUTO_CLOSE_COLOR,
        reviewerId,
        row: buildAutoClosedButtonRow(),
      }),
      member
        ?.send({
          embeds: [buildDmEmbed('⌛ Заявка закрыта', `${AUTO_CLOSE_REASON}.`, AUTO_CLOSE_COLOR)],
        })
        .catch(() => null) ?? Promise.resolve(null),
      postDecisionMessage(client, gc.channels.decisions, 'application', {
        label: AUTO_CLOSE_LABEL,
        color: AUTO_CLOSE_COLOR,
        reviewerId,
        targetUserId: app.userId,
        reviewMessageUrl: claimed.reviewMessageUrl,
        reason: { title: 'Причина', text: AUTO_CLOSE_REASON },
        number: claimed.number,
      }),
    ]),
  );
}

async function sweepGuild(client: Client, guild: Guild, expiredBefore: number): Promise<void> {
  const gc = await getGuildConfig(guild.id);
  if (!gc) return;

  const apps = await listExpiredPendingApplications(guild.id, expiredBefore);
  if (apps.length === 0) return;

  logSettledFailures(
    'applicationCleanup',
    await mapWithConcurrency(apps, CLOSE_CONCURRENCY, (app) =>
      closeExpiredApplication(client, guild, gc, app),
    ),
  );
}

async function sweep(client: Client): Promise<void> {
  const expiredBefore = Date.now() - APPLICATION_TTL_MS;

  logSettledFailures(
    'applicationCleanup',
    await Promise.allSettled(
      [...client.guilds.cache.values()].map((guild) => sweepGuild(client, guild, expiredBefore)),
    ),
  );
}

export function registerApplicationCleanup(client: Client): void {
  const run = (): void => {
    void sweep(client).catch((e) => console.error('[applicationCleanup] ошибка прохода', e));
  };

  client.once(Events.ClientReady, () => {
    console.log(
      `[applicationCleanup] включено: TTL=${Math.round(APPLICATION_TTL_MS / 3_600_000)} ч, ` +
        `проверка каждые ${Math.round(SWEEP_INTERVAL_MS / 1000)} с`,
    );
    run();
    setInterval(run, SWEEP_INTERVAL_MS);
  });
}
