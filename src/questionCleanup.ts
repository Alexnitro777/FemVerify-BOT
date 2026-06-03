import { Client } from 'discord.js';
import { config } from './config';
import {
  listApplicationsWithQuestionChannel,
  listAppealsWithQuestionChannel,
} from './storage';
import { restoreReviewButton } from './questionRestore';

const QUESTION_TTL_MS = 24 * 60 * 60_000;

const SWEEP_INTERVAL_MS = Math.min(
  5 * 60_000,
  Math.max(10_000, Math.floor(QUESTION_TTL_MS / 4)),
);

async function sweep(client: Client): Promise<void> {
  const channelIds = [
    ...listApplicationsWithQuestionChannel(),
    ...listAppealsWithQuestionChannel(),
  ]
    .map((entry) => entry.questionChannelId)
    .filter((id): id is string => Boolean(id));

  if (channelIds.length === 0) return;

  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return;

  const now = Date.now();

  for (const channelId of channelIds) {
    const channel = await guild.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      // Канал уже исчез — вернём кнопку «Задать вопрос» и почистим запись.
      await restoreReviewButton(client, channelId);
      continue;
    }

    const createdAt = channel.createdTimestamp;
    if (createdAt === null) continue;

    const age = now - createdAt;
    if (age < QUESTION_TTL_MS) continue;

    await channel
      .delete('Автоудаление: вопрос не закрыли вовремя')
      .catch((e) => {
        console.error('[questionCleanup] не удалось удалить канал', e);
        return null;
      });

    // После удаления возвращаем кнопку «Задать вопрос».
    await restoreReviewButton(client, channelId);
  }
}

export function registerQuestionCleanup(client: Client): void {
  const run = (): void => {
    void sweep(client).catch((e) =>
      console.error('[questionCleanup] ошибка прохода', e),
    );
  };

  client.once('clientReady', () => {
    console.log(
      `[questionCleanup] включено: TTL=${Math.round(QUESTION_TTL_MS / 60_000)} мин, ` +
        `проверка каждые ${Math.round(SWEEP_INTERVAL_MS / 1000)} с`,
    );
    run();
    setInterval(run, SWEEP_INTERVAL_MS);
  });
}
