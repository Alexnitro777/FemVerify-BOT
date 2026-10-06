import { Client, Events, GuildMember, Message } from 'discord.js';
import { GuildConfig } from './types';
import { getGuildConfig } from './guildConfig';
import { blacklistMemberRoles } from './roles';
import { getApplication, upsertBlacklistedApplication } from './storage';
import { applyGlobalBlacklist } from './sync';
import { buildDmEmbed, postDecisionMessage, markReviewMessageResolved } from './ui';
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

async function handleTrapMessage(client: Client, message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.inGuild() || !message.guild) return;

  const gc = await getGuildConfig(message.guild.id);
  if (!gc || !gc.channels.trap || !gc.channels.trap.includes(message.channelId)) return;

  if (isOwner(message.author.id)) return;

  const member =
    message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));

  if (member && hasStaffImmunity(member, gc)) return;

  await message.delete().catch(() => null);

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

export function registerTrapChannel(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    void handleTrapMessage(client, message).catch((e) =>
      console.error('[trapChannel] messageCreate handler failed', e),
    );
  });
}
