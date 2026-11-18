import { Guild, GuildBasedChannel, Message, TextChannel } from 'discord.js';
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
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (batch.size === 0) break;
    messages.push(...batch.values());
    if (batch.size < 100) break;
    const nextBefore = batch.last()?.id;
    if (!nextBefore || nextBefore === before) throw new Error('Question history pagination did not advance');
    before = nextBefore;
  }
  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function logQuestionChannel(
  guild: Guild,
  channel: TextChannel,
  opts?: DeleteQuestionChannelOptions,
): Promise<boolean> {
  const gc = await getGuildConfig(guild.id);
  const logChannelId = gc?.channels.questionLog ?? gc?.channels.decisions;
  if (!logChannelId) return true;

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
  return postQuestionLogMessage(guild.client, logChannelId, info, transcript);
}

const deletingChannels = new Map<string, Promise<boolean>>();

function channelIsMissing(error: unknown): boolean {
  const value = error as { code?: number; status?: number };
  return value?.code === 10003 || value?.status === 404;
}

export async function deleteQuestionChannel(
  guild: Guild,
  channelId: string | undefined,
  reasonOrOpts?: string | DeleteQuestionChannelOptions,
  closedByUserId?: string,
): Promise<boolean> {
  if (!channelId || channelId.startsWith('pending:')) return false;

  const current = deletingChannels.get(channelId);
  if (current) return current;

  const deletion = deleteQuestionChannelOnce(guild, channelId, reasonOrOpts, closedByUserId);
  deletingChannels.set(channelId, deletion);
  const cleanup = (): void => {
    if (deletingChannels.get(channelId) === deletion) deletingChannels.delete(channelId);
  };
  void deletion.then(cleanup, cleanup);
  return deletion;
}

async function deleteQuestionChannelOnce(
  guild: Guild,
  channelId: string,
  reasonOrOpts?: string | DeleteQuestionChannelOptions,
  closedByUserId?: string,
): Promise<boolean> {
  let channel: GuildBasedChannel | null;
  try {
    channel = await guild.channels.fetch(channelId);
  } catch (error) {
    if (channelIsMissing(error)) return true;
    console.error('[channels] не удалось получить канал-вопрос', channelId, error);
    return false;
  }
  if (!channel) return true;

  const opts: DeleteQuestionChannelOptions =
    typeof reasonOrOpts === 'string'
      ? { reason: reasonOrOpts, closedByUserId }
      : reasonOrOpts ?? (closedByUserId ? { closedByUserId } : {});

  if (channel.isTextBased()) {
    const archived = await logQuestionChannel(guild, channel as TextChannel, opts).catch((e) => {
      console.error('[channels] не удалось залогировать канал-вопрос', channelId, e);
      return false;
    });
    if (!archived) return false;
  }

  const deleted = await channel
    .delete(opts.reason)
    .then(() => true)
    .catch((e) => {
      if (channelIsMissing(e)) return true;
      console.error('[channels] не удалось удалить канал-вопрос', channelId, e);
      return false;
    });

  return deleted;
}
