import {
  Client,
  Events,
  GuildMember,
  Message,
  PartialMessage,
  ReadonlyCollection,
  Routes,
} from 'discord.js';
import { GuildConfig } from './types';
import { getGuildConfig } from './guildConfig';
import { blacklistMemberRoles } from './roles';
import {
  getApplication,
  upsertBlacklistedApplication,
  getTrapKicksCount,
  incrementTrapKicksCount,
} from './storage';
import { applyGlobalBlacklist } from './sync';
import {
  buildDmEmbed,
  postDecisionMessage,
  markReviewMessageResolved,
  buildTrapMessagePayload,
} from './ui';
import { deleteQuestionChannel } from './channels';
import { isMainGuild, getMainGuildInvite } from './config';
import { isOwner } from './permissions';
import { logSettledFailures } from './concurrency';

const REASON = 'Автовыдача: Взлом/Реклама';

function hasStaffImmunity(member: GuildMember, gc: GuildConfig): boolean {
  return (
    gc.roles.staff.some((id) => member.roles.cache.has(id)) ||
    gc.roles.ststaff.some((id) => member.roles.cache.has(id))
  );
}

const trapLocks = new Map<string, Promise<void>>();

function runExclusive(key: string, task: () => Promise<void>): Promise<void> {
  const prev = trapLocks.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  trapLocks.set(key, next);
  void next.finally(() => {
    if (trapLocks.get(key) === next) trapLocks.delete(key);
  });
  return next;
}

const activeTrapMessages = new Map<string, string>();
const channelLocks = new Map<string, Promise<void>>();

function runExclusiveChannel(channelId: string, task: () => Promise<void>): Promise<void> {
  const prev = channelLocks.get(channelId) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(task);
  channelLocks.set(channelId, next);
  void next.finally(() => {
    if (channelLocks.get(channelId) === next) channelLocks.delete(channelId);
  });
  return next;
}

export async function ensureTrapChannelMessage(
  client: Client,
  guildId: string,
  channelId: string,
  knownCount?: number,
): Promise<void> {
  return runExclusiveChannel(channelId, async () => {
    const channel =
      client.channels.cache.get(channelId) ??
      (await client.channels.fetch(channelId).catch(() => null));
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return;

    const count = knownCount ?? (await getTrapKicksCount(guildId));
    const avatarUrl = client.user?.displayAvatarURL({ extension: 'png', size: 256 });
    const payload = buildTrapMessagePayload(count, avatarUrl);

    const trackedId = activeTrapMessages.get(channelId);
    if (trackedId) {
      const existing = await channel.messages.fetch(trackedId).catch(() => null);
      if (existing) {
        await client.rest
          .patch(Routes.channelMessage(channelId, trackedId), {
            body: payload,
          })
          .catch(() => null);
        return;
      }
      activeTrapMessages.delete(channelId);
    }

    const fetched = await channel.messages.fetch({ limit: 10 }).catch(() => null);
    if (fetched) {
      const botMsgs = fetched.filter((m) => m.author.id === client.user?.id);
      if (botMsgs.size > 0) {
        const latest = botMsgs.first()!;
        activeTrapMessages.set(channelId, latest.id);
        await client.rest
          .patch(Routes.channelMessage(channelId, latest.id), {
            body: payload,
          })
          .catch(() => null);
        for (const [id, msg] of botMsgs) {
          if (id !== latest.id) {
            await msg.delete().catch(() => null);
          }
        }
        return;
      }
    }

    const created = (await client.rest
      .post(Routes.channelMessages(channelId), {
        body: payload,
      })
      .catch((e) => {
        console.error(`[trapChannel] failed to post trap message in channel ${channelId}`, e);
        return null;
      })) as { id: string } | null;

    if (created?.id) {
      activeTrapMessages.set(channelId, created.id);
    }
  });
}

export async function refreshTrapChannelMessages(
  client: Client,
  guildId: string,
  kicksCount?: number,
): Promise<void> {
  const gc = await getGuildConfig(guildId);
  if (!gc || !gc.channels.trap) return;
  const count = kicksCount ?? (await getTrapKicksCount(guildId));
  for (const channelId of gc.channels.trap) {
    void ensureTrapChannelMessage(client, guildId, channelId, count).catch((e) =>
      console.error(`[trapChannel] ensureTrapChannelMessage failed for ${channelId}`, e),
    );
  }
}

async function handleTrapMessage(client: Client, message: Message): Promise<void> {
  if (!message.inGuild() || !message.guild) return;

  const gc = await getGuildConfig(message.guild.id);
  if (!gc || !gc.channels.trap || !gc.channels.trap.includes(message.channelId)) return;

  if (message.author.id === client.user?.id) return;

  await message.delete().catch(() => null);

  if (message.author.bot) return;

  if (isOwner(message.author.id)) return;

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));

  if (member && hasStaffImmunity(member, gc)) return;

  await runExclusive(message.author.id, async () => {
    if (member && member.roles.cache.has(gc.roles.blacklist)) return;

    const guild = message.guild!;
    const guildId = guild.id;
    const userId = message.author.id;

    let removedRoles: string[] = [];
    if (member) {
      const res = await blacklistMemberRoles(member, gc);
      removedRoles = res.removed;
    }

    const existing = await getApplication(guildId, userId);

    await upsertBlacklistedApplication({
      guildId,
      userId,
      username: message.author.tag,
      reason: REASON,
      reviewerId: client.user!.id,
      removedRoles,
    });

    const newKicksCount = await incrementTrapKicksCount(guildId);
    void refreshTrapChannelMessages(client, guildId, newKicksCount).catch((e) =>
      console.error('[trapChannel] refreshTrapChannelMessages failed', e),
    );

    void applyGlobalBlacklist(client, userId, REASON, client.user!.id, guildId).catch((e) =>
      console.error('[trapChannel] applyGlobalBlacklist failed', e),
    );

    const wasOpen = existing?.status === 'pending' || existing?.status === 'amnestied';

    const isMain = isMainGuild(guildId);
    const invite = getMainGuildInvite();
    const appealTarget = isMain
      ? (gc.channels.appeal ? `<#${gc.channels.appeal}>` : 'соответствующем канале')
      : (invite ? `основном сервере проекта (${invite})` : 'основном сервере проекта');
    const appealPhrase = isMain ? `в ${appealTarget}` : `на ${appealTarget}`;

    const logChannel = gc.channels.blacklistLog ?? gc.channels.decisions;

    logSettledFailures(
      'trapChannel',
      await Promise.allSettled([
        message.author
          .send({
            embeds: [
              buildDmEmbed(
                '🚫 Вы добавлены в чёрный список',
                `Причина: \`${REASON}\`\n\nВы можете подать апелляцию ${appealPhrase}.`,
                0x992d22,
              ),
            ],
          })
          .catch(() => null),
        wasOpen
          ? markReviewMessageResolved(client, existing?.reviewMessageUrl, {
              kind: 'application',
              label: 'ЧС',
              color: 0x992d22,
              reviewerId: client.user!.id,
              reason: { title: 'Причина ЧС', text: REASON },
            })
          : Promise.resolve(),
        deleteQuestionChannel(guild, existing?.questionChannelId, 'Автовыдача ЧСП'),
        postDecisionMessage(client, logChannel, 'application', {
          label: 'ЧС',
          color: 0x992d22,
          reviewerId: client.user!.id,
          targetUserId: userId,
          reason: { title: 'Причина ЧС', text: REASON },
          number: existing?.number,
          title: 'Автовыдача ЧСП',
        }),
        member?.voice.channelId
          ? member.voice.disconnect('ЧСП: ' + REASON).catch(() => null)
          : Promise.resolve(),
      ]),
    );
  });
}

async function handleMessageDelete(
  client: Client,
  message: Message | PartialMessage,
): Promise<void> {
  const channelId = message.channelId;
  if (!channelId) return;

  const channel =
    client.channels.cache.get(channelId) ??
    (await client.channels.fetch(channelId).catch(() => null));
  const guildId =
    message.guild?.id ??
    (channel && 'guildId' in channel ? (channel.guildId as string) : undefined);
  if (!guildId) return;

  const gc = await getGuildConfig(guildId);
  if (!gc || !gc.channels.trap || !gc.channels.trap.includes(channelId)) return;

  const trackedId = activeTrapMessages.get(channelId);
  if (trackedId && message.id !== trackedId) return;

  activeTrapMessages.delete(channelId);
  await ensureTrapChannelMessage(client, guildId, channelId);
}

async function handleMessageBulkDelete(
  client: Client,
  messages: ReadonlyCollection<string, Message<true> | PartialMessage<true>>,
  channel: unknown,
): Promise<void> {
  const ch = channel as { id?: string; guildId?: string };
  if (!ch?.id || !ch?.guildId) return;

  const gc = await getGuildConfig(ch.guildId);
  if (!gc || !gc.channels.trap || !gc.channels.trap.includes(ch.id)) return;

  const trackedId = activeTrapMessages.get(ch.id);
  if (trackedId && messages.has(trackedId)) {
    activeTrapMessages.delete(ch.id);
  }

  const textChannel =
    client.channels.cache.get(ch.id) ??
    (await client.channels.fetch(ch.id).catch(() => null));
  if (textChannel && 'messages' in textChannel) {
    const fetched = await (textChannel as any).messages.fetch({ limit: 10 }).catch(() => null);
    if (fetched && fetched.some((m: Message) => m.author.id === client.user?.id)) {
      return;
    }
  }

  await ensureTrapChannelMessage(client, ch.guildId, ch.id);
}

export function initAllTrapChannels(client: Client): void {
  for (const guild of client.guilds.cache.values()) {
    void (async () => {
      const gc = await getGuildConfig(guild.id);
      if (!gc || !gc.channels.trap) return;
      for (const channelId of gc.channels.trap) {
        await ensureTrapChannelMessage(client, guild.id, channelId).catch((e) =>
          console.error(`[trapChannel] initAllTrapChannels failed for ${channelId}`, e),
        );
      }
    })();
  }
}

export function registerTrapChannel(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    void handleTrapMessage(client, message).catch((e) =>
      console.error('[trapChannel] messageCreate handler failed', e),
    );
  });

  client.on(Events.MessageDelete, (message) => {
    void handleMessageDelete(client, message).catch((e) =>
      console.error('[trapChannel] messageDelete handler failed', e),
    );
  });

  client.on(Events.MessageBulkDelete, (messages, channel) => {
    void handleMessageBulkDelete(client, messages, channel).catch((e) =>
      console.error('[trapChannel] messageBulkDelete handler failed', e),
    );
  });

  client.on(Events.GuildCreate, (guild) => {
    void (async () => {
      const gc = await getGuildConfig(guild.id);
      if (!gc || !gc.channels.trap) return;
      for (const channelId of gc.channels.trap) {
        await ensureTrapChannelMessage(client, guild.id, channelId).catch((e) =>
          console.error(`[trapChannel] guildCreate trap init failed for ${channelId}`, e),
        );
      }
    })();
  });

  if (client.isReady()) {
    initAllTrapChannels(client);
  } else {
    client.once(Events.ClientReady, () => {
      initAllTrapChannels(client);
    });
  }
}
