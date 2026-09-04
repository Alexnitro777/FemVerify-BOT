import { Guild } from 'discord.js';

export async function deleteQuestionChannel(
  guild: Guild,
  channelId: string | undefined,
  reason?: string,
): Promise<void> {
  if (!channelId || channelId.startsWith('pending:')) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return;
  await channel.delete(reason).catch((e) => {
    console.error('[channels] не удалось удалить канал-вопрос', channelId, e);
    return null;
  });
}
