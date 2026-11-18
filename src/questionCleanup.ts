import { Client, Events, Guild, GuildBasedChannel } from 'discord.js';
import {
  listApplicationQuestionChannelIds,
  listAppealQuestionChannelIds,
  listRecordedQuestions,
  getApplicationByQuestionChannel,
  getAppealByQuestionChannel,
} from './storage';
import { restoreReviewButton } from './questionRestore';
import { mapWithConcurrency, logSettledFailures, runUserExclusive } from './concurrency';
import { deleteQuestionChannel } from './channels';

const QUESTION_TTL_MS = 2 * 24 * 60 * 60_000;

const SWEEP_INTERVAL_MS = Math.min(
  5 * 60_000,
  Math.max(10_000, Math.floor(QUESTION_TTL_MS / 4)),
);

const SWEEP_CONCURRENCY = 5;

interface QuestionTarget {
  channelId: string;
  kind: 'application' | 'appeal';
  userId?: string;
}

function isChannelNotFoundError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const code = (err as { code?: number })?.code;
  return status === 404 || code === 10003;
}

async function sweepQuestionChannel(
  client: Client,
  guild: Guild,
  now: number,
  target: QuestionTarget,
): Promise<void> {
  const { channelId, kind } = target;
  const reference = kind === 'appeal'
    ? await getAppealByQuestionChannel(channelId)
    : await getApplicationByQuestionChannel(channelId);
  const userId = target.userId ?? reference?.userId;
  if (!userId) return;

  await runUserExclusive(userId, async () => {
    const current = kind === 'appeal'
      ? await getAppealByQuestionChannel(channelId)
      : await getApplicationByQuestionChannel(channelId);
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

    if (current?.status === 'pending') {
      if (kind === 'appeal') return;
      const createdAt = channel.createdTimestamp;
      if (createdAt === null || now - createdAt < QUESTION_TTL_MS) return;
    }

    const deleted = await deleteQuestionChannel(
      guild,
      channel.id,
      {
        reason: current?.status === 'pending'
          ? 'Автоудаление: вопрос не закрыли вовремя'
          : 'Завершённый канал-вопрос',
        targetUserId: userId,
        number: current?.number,
        reviewMessageUrl: current?.reviewMessageUrl,
        kind,
      },
    );
    if (deleted) {
      console.log(`[questionCleanup] удалён канал вопроса ${channel.name} (${channel.id})`);
      await restoreReviewButton(client, channelId);
    }
  });
}

async function sweepGuild(client: Client, guild: Guild, now: number): Promise<void> {
  const [applicationChannelIds, appealChannelIds, recorded, channels] = await Promise.all([
    listApplicationQuestionChannelIds(guild.id),
    listAppealQuestionChannelIds(guild.id),
    listRecordedQuestions(guild.id),
    guild.channels.fetch().catch(() => null),
  ]);
  const targets = new Map<string, QuestionTarget>();
  for (const channel of channels?.values() ?? []) {
    if (!channel || !('topic' in channel) || typeof channel.topic !== 'string') continue;
    const marker = /^femverify:question:(application|appeal):(\d+):(?:\d+|undefined)$/.exec(channel.topic);
    if (marker) {
      targets.set(channel.id, {
        channelId: channel.id,
        kind: marker[1] as 'application' | 'appeal',
        userId: marker[2],
      });
    }
  }
  for (const entry of recorded) {
    if (channels?.has(entry.channelId)) targets.set(entry.channelId, entry);
  }
  for (const channelId of applicationChannelIds) {
    targets.set(channelId, { ...targets.get(channelId), channelId, kind: 'application' });
  }
  for (const channelId of appealChannelIds) {
    targets.set(channelId, { ...targets.get(channelId), channelId, kind: 'appeal' });
  }

  if (targets.size > 0) {
    logSettledFailures(
      'questionCleanup',
      await mapWithConcurrency([...targets.values()], SWEEP_CONCURRENCY, (target) =>
        sweepQuestionChannel(client, guild, now, target),
      ),
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
