import { Client, Guild, GuildMember } from 'discord.js';
import { GuildConfig } from './types';
import { getGuildConfig } from './guildConfig';
import { blacklistMemberRoles, restoreMemberRoles } from './roles';
import {
  getApplication,
  updateApplication,
  amnestyApplication,
  upsertBlacklistedApplication,
  getAppeal,
  updateAppeal,
} from './storage';
import { postDecisionMessage, markReviewMessageResolved } from './ui';
import { deleteQuestionChannel } from './channels';
import { mapWithConcurrency, logSettledFailures } from './concurrency';

const GUILD_CONCURRENCY = 5;

async function forEachGuild(
  client: Client,
  excludeGuildId: string | undefined,
  fn: (guild: Guild, gc: GuildConfig) => Promise<void>,
): Promise<void> {
  const guilds = [...client.guilds.cache.values()].filter((guild) => guild.id !== excludeGuildId);

  const results = await mapWithConcurrency(guilds, GUILD_CONCURRENCY, async (guild) => {
    const gc = await getGuildConfig(guild.id).catch(() => null);
    if (!gc) return;
    await fn(guild, gc);
  });

  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[sync] гильдия ${guilds[index].id} не обработана:`, result.reason);
    }
  });
}

async function getMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
}

async function closeUiMessage(
  client: Client,
  guild: Guild,
  reviewMessageUrl: string | undefined,
  questionChannelId: string | undefined,
  label: string,
  color: number,
  kind: 'application' | 'appeal',
): Promise<void> {
  await Promise.allSettled([
    markReviewMessageResolved(client, reviewMessageUrl, {
      kind,
      label,
      color,
      reviewerId: client.user!.id,
    }),
    deleteQuestionChannel(guild, questionChannelId),
  ]);
}

export async function applyGlobalBlacklist(
  client: Client,
  userId: string,
  reason: string,
  reviewerId: string,
  excludeGuildId?: string,
): Promise<void> {
  await forEachGuild(client, excludeGuildId, async (guild, gc) => {
    const [member, existing, appeal] = await Promise.all([
      getMember(guild, userId),
      getApplication(guild.id, userId),
      getAppeal(guild.id, userId),
    ]);

    let removedRoles: string[] = [];
    if (member && !member.roles.cache.has(gc.roles.blacklist)) {
      const result = await blacklistMemberRoles(member, gc);
      if (result.ok) removedRoles = result.removed;
    }

    const tail: Promise<unknown>[] = [];

    if (existing) {
      const wasPending = existing.status === 'pending';
      tail.push(
        updateApplication(guild.id, userId, {
          status: 'blacklisted',
          reason,
          reviewerId,
          removedRoles: removedRoles.length ? removedRoles : existing.removedRoles,
          questionChannelId: wasPending ? undefined : existing.questionChannelId,
        }),
      );
      if (wasPending) {
        tail.push(
          closeUiMessage(
            client,
            guild,
            existing.reviewMessageUrl,
            existing.questionChannelId,
            'Авто-ЧСП (Глобально)',
            0x992d22,
            'application',
          ),
        );
      }
    } else {
      tail.push(
        upsertBlacklistedApplication({
          guildId: guild.id,
          userId,
          username: member ? member.user.tag : 'Unknown',
          reason,
          reviewerId,
          removedRoles,
        }),
      );
    }

    if (appeal && appeal.status === 'pending') {
      tail.push(
        (async () => {
          await updateAppeal(guild.id, userId, {
            status: 'denied',
            reviewerId: client.user!.id,
            questionChannelId: undefined,
          });
          await closeUiMessage(
            client,
            guild,
            appeal.reviewMessageUrl,
            appeal.questionChannelId,
            'Авто-Отказ (Новый ЧС)',
            0x992d22,
            'appeal',
          );
        })(),
      );
    }

    tail.push(
      postDecisionMessage(client, gc.channels.blacklistLog, 'application', {
        label: 'Глобальный ЧС',
        color: 0x992d22,
        reviewerId,
        targetUserId: userId,
        reason: { title: 'Причина', text: reason },
        title: 'Автоматическая выдача ЧСП',
      }),
    );

    logSettledFailures('sync', await Promise.allSettled(tail));
  });
}

export async function removeGlobalBlacklist(
  client: Client,
  userId: string,
  excludeGuildId?: string,
): Promise<void> {
  await forEachGuild(client, excludeGuildId, async (guild, gc) => {
    const [member, existing, appeal] = await Promise.all([
      getMember(guild, userId),
      getApplication(guild.id, userId),
      getAppeal(guild.id, userId),
    ]);

    const tail: Promise<unknown>[] = [];

    if (existing) {
      tail.push(amnestyApplication(guild.id, userId));
    }

    if (appeal && appeal.status === 'pending') {
      tail.push(
        (async () => {
          await updateAppeal(guild.id, userId, {
            status: 'amnestied',
            reviewerId: client.user!.id,
            questionChannelId: undefined,
          });
          await closeUiMessage(
            client,
            guild,
            appeal.reviewMessageUrl,
            appeal.questionChannelId,
            'Авто-Амнистия (Глобально)',
            0x57f287,
            'appeal',
          );
        })(),
      );
    }

    if (member) {
      tail.push(
        (async () => {
          await member.roles.remove(gc.roles.blacklist).catch(() => null);
          if (existing?.removedRoles?.length) {
            await restoreMemberRoles(member, gc, existing.removedRoles);
          }
        })(),
      );
    }

    tail.push(
      postDecisionMessage(client, gc.channels.blacklistLog, 'application', {
        label: 'Снят с ЧС (Глобально)',
        color: 0x57f287,
        reviewerId: client.user!.id,
        targetUserId: userId,
        reason: { title: 'Причина', text: 'Снятие ЧС на другом сервере' },
        title: 'Снятие ЧСП',
      }),
    );

    logSettledFailures('sync', await Promise.allSettled(tail));
  });
}

export async function applyGlobalVerification(
  client: Client,
  userId: string,
  excludeGuildId?: string,
): Promise<void> {
  await forEachGuild(client, excludeGuildId, async (guild, gc) => {
    const [existing, member] = await Promise.all([
      getApplication(guild.id, userId),
      getMember(guild, userId),
    ]);

    const tail: Promise<unknown>[] = [];

    if (existing && existing.status === 'pending') {
      tail.push(
        (async () => {
          await updateApplication(guild.id, userId, {
            status: 'approved',
            reviewerId: client.user!.id,
            questionChannelId: undefined,
          });
          await closeUiMessage(
            client,
            guild,
            existing.reviewMessageUrl,
            existing.questionChannelId,
            'Авто-Принято (Глобально)',
            0x57f287,
            'application',
          );
        })(),
      );
    }

    if (member && !member.roles.cache.has(gc.roles.verified)) {
      tail.push(
        member.roles.add(gc.roles.verified).then(
          () =>
            postDecisionMessage(client, gc.channels.decisions, 'application', {
              label: 'Авто-Верификация',
              color: 0x57f287,
              reviewerId: client.user!.id,
              targetUserId: userId,
              reason: { title: 'Причина', text: 'Одобрение заявки на другом сервере' },
              title: 'Автоматическая верификация',
            }),
          (e) => {
            console.error(`[sync] не удалось выдать роль верификации в ${guild.id}:`, e);
          },
        ),
      );
    }

    logSettledFailures('sync', await Promise.allSettled(tail));
  });
}
