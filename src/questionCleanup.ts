import { Client, Events, Guild } from 'discord.js';
import {
  listApplicationQuestionChannelIds,
  listAppealQuestionChannelIds,
} from './storage';
import { restoreReviewButton } from './questionRestore';
import { mapWithConcurrency, logSettledFailures } from './concurrency';

const QUESTION_TTL_MS = 2 * 24 * 60 * 60_000;

const SWEEP_INTERVAL_MS = Math.min(
  5 * 60_000,
  Math.max(10_000, Math.floor(QUESTION_TTL_MS / 4)),
);

const SWEEP_CONCURRENCY = 5;

async function sweepQuestionChannel(
  client: Client,
  guild: Guild,
  now: number,
  channelId: string,
  ttlDelete: boolean,
): Promise<void> {
  const channel = await guild.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    await restoreReviewButton(client, channelId);
    return;
  }

  if (!ttlDelete) return;

  const createdAt = channel.createdTimestamp;
  if (createdAt === null) return;
  if (now - createdAt < QUESTION_TTL_MS) return;

  await channel.delete('Автоудаление: вопрос не закрыли вовремя').catch((e) => {
    console.error('[questionCleanup] не удалось удалить канал', e);
    return null;
  });

  await restoreReviewButton(client, channelId);
}

async function sweepGuild(client: Client, guild: Guild, now: number): Promise<void> {
  const [applicationChannelIds, appealChannelIds] = await Promise.all([
    listApplicationQuestionChannelIds(guild.id),
    listAppealQuestionChannelIds(guild.id),
  ]);

  const targets = [
    ...applicationChannelIds.map((channelId) => ({ channelId, ttlDelete: true })),
    ...appealChannelIds.map((channelId) => ({ channelId, ttlDelete: false })),
  ];
  if (targets.length === 0) return;

  logSettledFailures(
    'questionCleanup',
    await mapWithConcurrency(targets, SWEEP_CONCURRENCY, (target) =>
      sweepQuestionChannel(client, guild, now, target.channelId, target.ttlDelete),
    ),
  );
}

async function sweep(client: Client): Promise<void> {
  const now = Date.now();

  logSettledFailures(
    'questionCleanup',
    await Promise.allSettled(
      [...client.guilds.cache.values()].map((guild) => sweepGuild(client, guild, now)),
    ),
  );
}

export function registerQuestionCleanup(client: Client): void {
  const run = (): void => {
    void sweep(client).catch((e) => console.error('[questionCleanup] ошибка прохода', e));
  };

  client.once(Events.ClientReady, () => {
    console.log(
      `[questionCleanup] включено: TTL=${Math.round(QUESTION_TTL_MS / 3_600_000)} ч, ` +
        `проверка каждые ${Math.round(SWEEP_INTERVAL_MS / 1000)} с`,
    );
    run();
    setInterval(run, SWEEP_INTERVAL_MS);
  });
}
