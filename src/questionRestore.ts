import { ActionRowBuilder, ButtonBuilder, Client, TextChannel } from 'discord.js';
import {
  getApplicationByQuestionChannel,
  getAppealByQuestionChannel,
  updateApplication,
  updateAppealById,
} from './storage';
import { buildReviewButtons, buildAppealReviewButtons } from './ui';
import { runUserExclusive } from './concurrency';

async function editReviewMessage(
  client: Client,
  reviewMessageUrl: string | undefined,
  row: ActionRowBuilder<ButtonBuilder>,
): Promise<void> {
  if (!reviewMessageUrl) return;

  const parts = reviewMessageUrl.split('/');
  const messageId = parts[parts.length - 1];
  const channelId = parts[parts.length - 2];
  if (!messageId || !channelId) return;

  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const message = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
  if (!message) return;

  await message.edit({ components: [row] }).catch((e) => {
    console.error('[questionRestore] не удалось восстановить кнопку', e);
    return null;
  });
}

export async function restoreReviewButton(client: Client, channelId: string): Promise<void> {
  const app = await getApplicationByQuestionChannel(channelId);
  if (app) {
    await runUserExclusive(app.userId, async () => {
      const current = await getApplicationByQuestionChannel(channelId);
      if (!current) return;
      const updated = await updateApplication(current.guildId, current.userId, { questionChannelId: undefined });
      if (updated?.status === 'pending') {
        await editReviewMessage(client, current.reviewMessageUrl, buildReviewButtons(current.userId, undefined, current.number));
      }
    });
    return;
  }

  const appeal = await getAppealByQuestionChannel(channelId);
  if (appeal) {
    await runUserExclusive(appeal.userId, async () => {
      const current = await getAppealByQuestionChannel(channelId);
      if (!current) return;
      const updated = await updateAppealById(current.guildId, current.id, { questionChannelId: undefined });
      if (updated?.status === 'pending') {
        await editReviewMessage(
          client,
          current.reviewMessageUrl,
          buildAppealReviewButtons(current.userId, undefined, current.blacklistType, current.id),
        );
      }
    });
  }
}
