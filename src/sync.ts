import { Client, Guild, GuildMember } from 'discord.js';
import { GuildConfig } from './types';
import { getGuildConfig } from './guildConfig';
import { blacklistMemberRoles, restoreMemberRoles } from './roles';
import {
  getApplication,
  amnestyApplication,
  clearApplicationRemovedRoles,
  upsertBlacklistedApplication,
  getPendingAppeals,
  claimApplication,
  claimAppeal,
  getUserGlobalStatus,
} from './storage';
import { postDecisionMessage, markReviewMessageResolved } from './ui';
import { deleteQuestionChannel } from './channels';
import { mapWithConcurrency, logSettledFailures, runUserExclusive } from './concurrency';

const GUILD_CONCURRENCY = 5;

async function forEachGuild(
  client: Client,
  excludeGuildId: string | undefined,
  fn: (guild: Guild, gc: GuildConfig) => Promise<void>,
): Promise<void> {
  const guilds = [...client.guilds.cache.values()].filter((guild) => guild.id !== excludeGuildId);
  const results = await mapWithConcurrency(guilds, GUILD_CONCURRENCY, async (guild) => {
    const gc = await getGuildConfig(guild.id);
    if (gc) await fn(guild, gc);
  });
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(`[sync] гильдия ${guilds[index].id} не обработана:`, result.reason);
    }
  });
}

async function getMember(guild: Guild, userId: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch (err) {
    if ((err as { code?: number }).code === 10007) return null;
    throw err;
  }
}

async function closeUiMessage(
  client: Client,
  guild: Guild,
  userId: string,
  reviewMessageUrl: string | undefined,
  questionChannelId: string | undefined,
  label: string,
  color: number,
  kind: 'application' | 'appeal',
  number?: number,
): Promise<void> {
  logSettledFailures('sync:close', await Promise.allSettled([
    markReviewMessageResolved(client, reviewMessageUrl, {
      kind, label, color, reviewerId: client.user!.id,
    }),
    deleteQuestionChannel(guild, questionChannelId, {
      targetUserId: userId, reviewMessageUrl, number, kind, reason: label,
    }),
  ]));
}

async function closeProjectAppeals(
  client: Client,
  guild: Guild,
  userId: string,
  status: 'amnestied' | 'denied',
): Promise<void> {
  const appeals = await getPendingAppeals(guild.id, userId);
  for (const appeal of appeals) {
    if ((appeal.blacklistType ?? 'ЧСП') !== 'ЧСП') continue;
    const claimed = await claimAppeal(
      guild.id, userId, status, client.user!.id, undefined, Date.now(), 'ЧСП', appeal.id,
    );
    if (!claimed) continue;
    await closeUiMessage(
      client, guild, userId, claimed.reviewMessageUrl, claimed.questionChannelId,
      status === 'amnestied' ? 'Авто-Амнистия (Глобально)' : 'Авто-Отказ (Новый ЧС)',
      status === 'amnestied' ? 0x57f287 : 0x992d22, 'appeal', claimed.number,
    );
  }
}

export async function applyGlobalBlacklist(
  client: Client,
  userId: string,
  reason: string,
  reviewerId: string,
  excludeGuildId?: string,
): Promise<void> {
  return runUserExclusive(userId, async () => {
    await forEachGuild(client, excludeGuildId, async (guild, gc) => {
      const existing = await getApplication(guild.id, userId);
      const claimed = existing?.status === 'pending'
        ? await claimApplication(guild.id, userId, 'blacklisted', reviewerId, reason, existing.number)
        : null;
      await upsertBlacklistedApplication({
        guildId: guild.id, userId, username: existing?.username ?? 'Unknown',
        reason, reviewerId, removedRoles: existing?.removedRoles,
      });
      const member = await getMember(guild, userId);
      if (member) {
        const result = await blacklistMemberRoles(member, gc);
        if (!result.ok) throw new Error(`Не удалось применить роли ЧСП для ${userId} в ${guild.id}`);
        await upsertBlacklistedApplication({
          guildId: guild.id, userId, username: member.user.tag, reason, reviewerId,
          removedRoles: [...new Set([...(existing?.removedRoles ?? []), ...result.removed])],
        });
      }
      if (claimed) {
        await closeUiMessage(
          client, guild, userId, claimed.reviewMessageUrl, claimed.questionChannelId,
          'Авто-ЧСП (Глобально)', 0x992d22, 'application', claimed.number,
        );
      }
      await closeProjectAppeals(client, guild, userId, 'denied');
      await postDecisionMessage(client, gc.channels.blacklistLog, 'application', {
        label: 'Глобальный ЧС', color: 0x992d22, reviewerId, targetUserId: userId,
        reason: { title: 'Причина', text: reason }, title: 'Автоматическая выдача ЧСП',
      });
    });
  });
}

export async function removeGlobalBlacklist(
  client: Client,
  userId: string,
  excludeGuildId?: string,
): Promise<void> {
  return runUserExclusive(userId, async () => {
    await forEachGuild(client, excludeGuildId, async (guild, gc) => {
      const existing = await getApplication(guild.id, userId);
      if (existing?.status === 'blacklisted') await amnestyApplication(guild.id, userId);
      const member = await getMember(guild, userId);
      if (member) {
        await member.roles.remove(gc.roles.blacklist);
        if (existing?.removedRoles?.length) {
          const restored = await restoreMemberRoles(member, gc, existing.removedRoles);
          if (!restored) throw new Error(`Не удалось вернуть роли ${userId} в ${guild.id}`);
          await clearApplicationRemovedRoles(guild.id, userId, existing.removedRoles);
        }
      }
      await closeProjectAppeals(client, guild, userId, 'amnestied');
      if (existing?.status === 'blacklisted') {
        await postDecisionMessage(client, gc.channels.blacklistLog, 'application', {
          label: 'Снят с ЧС (Глобально)', color: 0x57f287,
          reviewerId: client.user!.id, targetUserId: userId,
          reason: { title: 'Причина', text: 'Снятие ЧС на другом сервере' }, title: 'Снятие ЧСП',
        });
      }
    });
  });
}

export async function applyGlobalVerification(
  client: Client,
  userId: string,
  excludeGuildId?: string,
): Promise<void> {
  return runUserExclusive(userId, async () => {
    if ((await getUserGlobalStatus(userId)).blacklisted) return;
    await forEachGuild(client, excludeGuildId, async (guild, gc) => {
      const existing = await getApplication(guild.id, userId);
      if (existing?.status === 'blacklisted') return;
      const member = await getMember(guild, userId);
      if (!member || member.roles.cache.has(gc.roles.blacklist)) return;
      if (!member.roles.cache.has(gc.roles.verified)) await member.roles.add(gc.roles.verified);
      if (existing?.status === 'pending') {
        const claimed = await claimApplication(
          guild.id, userId, 'approved', client.user!.id, undefined, existing.number,
        );
        if (claimed) {
          await closeUiMessage(
            client, guild, userId, claimed.reviewMessageUrl, claimed.questionChannelId,
            'Авто-Принято (Глобально)', 0x57f287, 'application', claimed.number,
          );
        } else if ((await getUserGlobalStatus(userId)).blacklisted) {
          await member.roles.remove(gc.roles.verified);
          return;
        }
      }
      await postDecisionMessage(client, gc.channels.decisions, 'application', {
        label: 'Авто-Верификация', color: 0x57f287, reviewerId: client.user!.id,
        targetUserId: userId,
        reason: { title: 'Причина', text: 'Одобрение заявки на другом сервере' },
        title: 'Автоматическая верификация',
      });
    });
  });
}
