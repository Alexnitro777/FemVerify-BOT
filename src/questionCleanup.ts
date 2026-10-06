import { Client, Events, Guild, GuildBasedChannel } from 'discord.js';
import {
  listApplicationQuestionChannelIds,
  listAppealQuestionChannelIds,
} from './storage';
import { restoreReviewButton } from './questionRestore';
import { mapWithConcurrency, logSettledFailures } from './concurrency';
import { getGuildConfig } from './guildConfig';
import { deleteQuestionChannel } from './channels';

const QUESTION_TTL_MS = 2 * 24 * 60 * 60_000;

const SWEEP_INTERVAL_MS = Math.min(
  5 * 60_000,
  Math.max(10_000, Math.floor(QUESTION_TTL_MS / 4)),
);

const SWEEP_CONCURRENCY = 5;

function isChannelNotFoundError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: number })?.code;
  return status === 404 || code === 10003;
}

async function sweepQuestionChannel(
  client: Client,
  guild: Guild,
  now: number,
  channelId: string,
  ttlDelete: boolean,
): Promise<void> {
  let channel: GuildBasedChannel | null = null;
  try {
    channel = await guild.channels.fetch(channelId);
  } catch (err: unknown) {
    if (isChannelNotFoundError(err)) {
      await restoreReviewButton(client, channelId);
      return;
    }
    console.error('[questionCleanup] не удалось получить канал', channelId, err);
    return;
  }

  if (!channel) {
    await restoreReviewButton(client, channelId);
    return;
  }

  if (!ttlDelete) return;

  const createdAt = channel.createdTimestamp;
  if (createdAt === null) return;
  if (now - createdAt < QUESTION_TTL_MS) return;

  const deleted = await deleteQuestionChannel(
    guild,
    channel.id,
    'Автоудаление: вопрос не закрыли вовремя',
  );
  if (deleted) {
    console.log(`[questionCleanup] удалён канал вопроса ${channel.name} (${channel.id})`);
  }

  await restoreReviewButton(client, channelId);
}

async function sweepCategoryOrphans(
  client: Client,
  guild: Guild,
  now: number,
  categoryId: string,
  exemptChannelIds: Set<string>,
  trackedChannelIds: Set<string>,
): Promise<void> {
  const fetchedChannels = await guild.channels.fetch().catch(() => guild.channels.cache);
  const orphans = [...fetchedChannels.values()].filter((c): c is GuildBasedChannel => {
    if (!c || c.parentId !== categoryId || !c.isTextBased()) return false;
    if (exemptChannelIds.has(c.id)) return false;
    if (trackedChannelIds.has(c.id)) return false;
    const createdAt = c.createdTimestamp;
    if (createdAt === null) return false;
    return now - createdAt >= QUESTION_TTL_MS;
  });

  if (orphans.length === 0) return;

  logSettledFailures(
    'questionCleanup',
    await mapWithConcurrency(orphans, SWEEP_CONCURRENCY, async (channel) => {
      if (!channel) return;
      const deleted = await deleteQuestionChannel(
        guild,
        channel.id,
        'Автоудаление: вопрос не закрыли вовремя',
      );
      if (deleted) {
        console.log(`[questionCleanup] удалён осиротевший канал-вопрос ${channel.name} (${channel.id})`);
      }
      await restoreReviewButton(client, channel.id);
    }),
  );
}

async function sweepGuild(client: Client, guild: Guild, now: number): Promise<void> {
  const gc = await getGuildConfig(guild.id);
  const [applicationChannelIds, appealChannelIds] = await Promise.all([
    listApplicationQuestionChannelIds(guild.id),
    listAppealQuestionChannelIds(guild.id),
  ]);

  const targets = [
    ...applicationChannelIds.map((channelId) => ({ channelId, ttlDelete: true })),
    ...appealChannelIds.map((channelId) => ({ channelId, ttlDelete: false })),
  ];

  if (targets.length > 0) {
    logSettledFailures(
      'questionCleanup',
      await mapWithConcurrency(targets, SWEEP_CONCURRENCY, (target) =>
        sweepQuestionChannel(client, guild, now, target.channelId, target.ttlDelete),
      ),
    );
  }

  if (gc?.questionCategoryId) {
    const trackedChannelIds = new Set([
      ...applicationChannelIds,
      ...appealChannelIds,
    ]);
    const appealIds = new Set(appealChannelIds);
    await sweepCategoryOrphans(
      client,
      guild,
      now,
      gc.questionCategoryId,
      appealIds,
      trackedChannelIds,
    );
  }
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
