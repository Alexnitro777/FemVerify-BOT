import { Guild, Message, TextChannel } from 'discord.js';
import { getGuildConfig } from './guildConfig';
import { getApplicationByQuestionChannel, getAppealByQuestionChannel } from './storage';
import { DecisionKind, formatQuestionTranscript, postQuestionLogMessage, QuestionLogInfo } from './ui';

export interface DeleteQuestionChannelOptions {
  reason?: string;
  closedByUserId?: string;
  targetUserId?: string;
  number?: number;
  reviewMessageUrl?: string;
  kind?: DecisionKind;
}

async function fetchAllMessages(channel: TextChannel): Promise<Message[]> {
  const messages: Message[] = [];
  let before: string | undefined;
  while (messages.length < 500) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) }).catch(() => null);
    if (!batch || batch.size === 0) break;
    messages.push(...batch.values());
    if (batch.size < 100) break;
    before = batch.last()?.id;
  }
  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function logQuestionChannel(
  guild: Guild,
  channel: TextChannel,
  opts?: DeleteQuestionChannelOptions,
): Promise<void> {
  const gc = await getGuildConfig(guild.id);
  const logChannelId = gc?.channels.questionLog ?? gc?.channels.decisions;
  if (!logChannelId) return;

  const allMessages = await fetchAllMessages(channel);
  const userMessages = allMessages.filter((m) => !m.author.bot);

  const [app, appeal] = await Promise.all([
    opts?.targetUserId ? Promise.resolve(undefined) : getApplicationByQuestionChannel(channel.id).catch(() => undefined),
    opts?.targetUserId ? Promise.resolve(undefined) : getAppealByQuestionChannel(channel.id).catch(() => undefined),
  ]);

  const targetUserId = opts?.targetUserId ?? app?.userId ?? appeal?.userId ?? channel.name.replace(/^вопрос-/, '');
  const kind = opts?.kind ?? (appeal ? 'appeal' : 'application');
  const number = opts?.number ?? appeal?.number ?? app?.number;
  const reviewMessageUrl = opts?.reviewMessageUrl ?? appeal?.reviewMessageUrl ?? app?.reviewMessageUrl;

  const info: QuestionLogInfo = {
    channelName: channel.name,
    channelId: channel.id,
    targetUserId,
    closedByUserId: opts?.closedByUserId,
    closeReason: opts?.reason,
    messageCount: userMessages.length,
    reviewMessageUrl,
    kind,
    number,
  };

  const transcript = formatQuestionTranscript(userMessages);
  await postQuestionLogMessage(guild.client, logChannelId, info, transcript);
}

export async function deleteQuestionChannel(
  guild: Guild,
  channelId: string | undefined,
  reasonOrOpts?: string | DeleteQuestionChannelOptions,
  closedByUserId?: string,
): Promise<boolean> {
  if (!channelId || channelId.startsWith('pending:')) return false;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;

  const opts: DeleteQuestionChannelOptions =
    typeof reasonOrOpts === 'string'
      ? { reason: reasonOrOpts, closedByUserId }
      : reasonOrOpts ?? (closedByUserId ? { closedByUserId } : {});

  if (channel.isTextBased()) {
    await logQuestionChannel(guild, channel as TextChannel, opts).catch((e) => {
      console.error('[channels] не удалось залогировать канал-вопрос', channelId, e);
    });
  }

  const deleted = await channel
    .delete(opts.reason)
    .then(() => true)
    .catch((e) => {
      console.error('[channels] не удалось удалить канал-вопрос', channelId, e);
      return false;
    });

  return deleted;
}
