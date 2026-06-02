import { Client } from 'discord.js';
import { config } from './config';
import { listApplicationsWithQuestionChannel, updateApplication } from './storage';

const QUESTION_TTL_MS = 24 * 60 * 60_000;

const SWEEP_INTERVAL_MS = Math.min(
  5 * 60_000,
  Math.max(10_000, Math.floor(QUESTION_TTL_MS / 4)),
);

async function sweep(client: Client): Promise<void> {
  const apps = listApplicationsWithQuestionChannel();
  if (apps.length === 0) return;

  const guild = await client.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) return;

  const now = Date.now();

  for (const app of apps) {
    const channelId = app.questionChannelId;
    if (!channelId) continue;

    const channel = await guild.channels.fetch(channelId).catch(() => null);

    if (!channel) {
      updateApplication(app.userId, { questionChannelId: undefined });
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
    updateApplication(app.userId, { questionChannelId: undefined });
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
