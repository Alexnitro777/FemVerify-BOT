import { Client, Events, Guild, GuildMember, PartialGuildMember } from 'discord.js';
import {
  getApplication,
  getPendingAppeals,
  claimApplication,
  claimAppeal,
  updateApplication,
  updateAppealById,
} from './storage';
import { buildLeftServerButtonRow } from './ui';
import { deleteQuestionChannel } from './channels';
import { runUserExclusive } from './concurrency';

interface ParsedMessageUrl {
  guildId: string;
  channelId: string;
  messageId: string;
}

function parseMessageUrl(url: string): ParsedMessageUrl | null {
  const m = url.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (!m) return null;
  return { guildId: m[1], channelId: m[2], messageId: m[3] };
}

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

async function handleMemberRemove(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  const guild = member.guild;
  if (!guild) return;
  const guildId = guild.id;
  const userId = member.id;
  const reviewerId = guild.client.user?.id ?? guildId;

  const app = await getApplication(guildId, userId);
  if (app?.status === 'pending') {
    const claimed = await claimApplication(guildId, userId, 'left', reviewerId, undefined, app.number);
    if (claimed) {
      await markReviewMessageLeft(guild, claimed.reviewMessageUrl);
      if (claimed.questionChannelId) {
        const deleted = await deleteQuestionChannel(guild, claimed.questionChannelId, {
          reason: 'Участник покинул сервер с неразобранной заявкой',
          targetUserId: userId,
          number: claimed.number,
          reviewMessageUrl: claimed.reviewMessageUrl,
          kind: 'application',
        });
        if (!deleted) {
          await updateApplication(guildId, userId, { questionChannelId: claimed.questionChannelId });
        }
      }
    }
  }

  const appeals = await getPendingAppeals(guildId, userId);
  for (const appeal of appeals) {
    const claimed = await claimAppeal(
      guildId, userId, 'left', reviewerId, undefined, Date.now(), appeal.blacklistType, appeal.id,
    );
    if (!claimed) continue;
    await markReviewMessageLeft(guild, claimed.reviewMessageUrl);
    if (claimed.questionChannelId) {
      const deleted = await deleteQuestionChannel(guild, claimed.questionChannelId, {
        reason: 'Участник покинул сервер с неразобранной апелляцией',
        targetUserId: userId,
        number: claimed.number,
        reviewMessageUrl: claimed.reviewMessageUrl,
        kind: 'appeal',
      });
      if (!deleted) {
        await updateAppealById(guildId, claimed.id, { questionChannelId: claimed.questionChannelId });
      }
    }
  }
}

export function registerLeaveCleanupEvents(client: Client): void {
  client.on(Events.GuildMemberRemove, (member) => {
    void runUserExclusive(member.id, () => handleMemberRemove(member)).catch((e) =>
      console.error('[leaveCleanup] handler failed', e),
    );
  });
}
