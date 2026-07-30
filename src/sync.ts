import { Client } from 'discord.js';
import { getGuildConfig } from './guildConfig';
import { blacklistMemberRoles, restoreMemberRoles } from './roles';
import { getApplication, updateApplication, saveApplication } from './storage';
import { postDecisionMessage } from './ui';

export async function applyGlobalBlacklist(client: Client, userId: string, reason: string, reviewerId: string, excludeGuildId?: string): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === excludeGuildId) continue;
    const gc = await getGuildConfig(guild.id).catch(() => null);
    if (!gc) continue;
    
    const member = await guild.members.fetch(userId).catch(() => null);
    let removedRoles: string[] = [];
    if (member && !member.roles.cache.has(gc.roles.blacklist)) {
      const result = await blacklistMemberRoles(member, gc);
      if (result.ok) removedRoles = result.removed;
    }
    
    const existing = await getApplication(guild.id, userId);
    if (existing) {
      await updateApplication(guild.id, userId, {
        status: 'blacklisted',
        reason,
        reviewerId,
        removedRoles: removedRoles.length ? removedRoles : existing.removedRoles,
      });
    } else {
      await saveApplication({
        userId,
        username: member ? member.user.tag : 'Unknown',
        guildId: guild.id,
        answers: {},
        submittedAt: Date.now(),
        status: 'blacklisted',
        reason,
        reviewerId,
        removedRoles: removedRoles.length ? removedRoles : undefined,
      });
    }

    await postDecisionMessage(client, gc.channels.blacklistLog, 'application', {
      label: 'Глобальный ЧС',
      color: 0x992d22,
      reviewerId,
      targetUserId: userId,
      reason: { title: 'Причина', text: reason },
      title: 'Автоматическая выдача ЧСП',
    });
  }
}

export async function removeGlobalBlacklist(client: Client, userId: string, excludeGuildId?: string): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === excludeGuildId) continue;
    const gc = await getGuildConfig(guild.id).catch(() => null);
    if (!gc) continue;

    const existing = await getApplication(guild.id, userId);
    if (existing) {
      await updateApplication(guild.id, userId, { status: 'amnestied', removedRoles: [] });
    }
    
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      await member.roles.remove(gc.roles.blacklist).catch(() => null);
      if (existing && existing.removedRoles && existing.removedRoles.length > 0) {
        await restoreMemberRoles(member, gc, existing.removedRoles);
      }
    }

    await postDecisionMessage(client, gc.channels.blacklistLog, 'application', {
      label: 'Снят с ЧС (Глобально)',
      color: 0x57f287,
      reviewerId: client.user!.id,
      targetUserId: userId,
      reason: { title: 'Причина', text: 'Снятие ЧС на другом сервере' },
      title: 'Снятие ЧСП',
    });
  }
}

export async function applyGlobalVerification(client: Client, userId: string, excludeGuildId?: string): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    if (guild.id === excludeGuildId) continue;
    const gc = await getGuildConfig(guild.id).catch(() => null);
    if (!gc) continue;
    
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache.has(gc.roles.verified)) {
      await member.roles.add(gc.roles.verified).catch(() => null);
      await postDecisionMessage(client, gc.channels.decisions, 'application', {
        label: 'Авто-Верификация',
        color: 0x57f287,
        reviewerId: client.user!.id,
        targetUserId: userId,
        reason: { title: 'Причина', text: 'Одобрение заявки на другом сервере' },
        title: 'Автоматическая верификация',
      });
    }
  }
}
