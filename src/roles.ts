import { GuildMember } from 'discord.js';
import { GuildConfig } from './types';
import { getApplication, getSpecialBlacklistsForUser, clearApplicationRemovedRoles } from './storage';

export async function blacklistMemberRoles(
  member: GuildMember,
  gc: GuildConfig,
): Promise<{ ok: boolean; removed: string[] }> {
  const botTop = member.guild.members.me?.roles.highest.position ?? 0;
  const keep: string[] = [];
  const removed: string[] = [];

  for (const role of member.roles.cache.values()) {
    if (role.id === member.guild.id || role.id === gc.roles.blacklist) continue;
    if (
      role.managed || role.id === gc.roles.roleTag || role.id === gc.roles.blacklistZ ||
      role.id === gc.roles.blacklistA || role.position >= botTop
    ) {
      keep.push(role.id);
    } else {
      removed.push(role.id);
    }
  }

  try {
    await member.roles.set([...keep, gc.roles.blacklist]);
    return { ok: true, removed };
  } catch (e) {
    console.error('[roles] blacklistMemberRoles failed', e);
    return { ok: false, removed: [] };
  }
}

export async function restoreMemberRoles(
  member: GuildMember,
  gc: GuildConfig,
  roleIds: string[],
): Promise<boolean> {
  const botTop = member.guild.members.me?.roles.highest.position ?? 0;
  const specials = await getSpecialBlacklistsForUser(member.guild.id, member.id);
  const hasAdminBlacklist = specials.some((entry) => entry.type === 'ЧСА');
  const staffRoles = new Set([...gc.roles.staff, ...gc.roles.ststaff]);
  let complete = true;
  const toAdd = [...new Set(roleIds)].filter((id) => {
    if (id === gc.roles.verified || id === gc.roles.blacklist) return false;
    if (id === gc.roles.blacklistZ && !specials.some((entry) => entry.type === 'ЧСЗ')) return false;
    if (id === gc.roles.blacklistA && !hasAdminBlacklist) return false;
    if (hasAdminBlacklist && staffRoles.has(id)) return false;
    const role = member.guild.roles.cache.get(id);
    if (!role || role.managed) return false;
    if (role.position >= botTop) {
      complete = false;
      return false;
    }
    return true;
  });

  if (toAdd.length === 0) return complete;

  try {
    for (const roleId of toAdd) await member.roles.add(roleId);
    return complete;
  } catch (e) {
    console.error('[roles] restoreMemberRoles failed', e);
    return false;
  }
}

export async function liftProjectBlacklist(member: GuildMember, gc: GuildConfig): Promise<boolean> {
  const application = await getApplication(member.guild.id, member.id);
  if (application?.status === 'blacklisted') return false;
  try {
    await member.roles.remove(gc.roles.blacklist);
  } catch (error) {
    console.error('[roles] не удалось снять ЧСП', member.id, error);
    return false;
  }
  if (application?.status === 'amnestied' && application.removedRoles?.length) {
    if (!await restoreMemberRoles(member, gc, application.removedRoles)) return false;
    return clearApplicationRemovedRoles(member.guild.id, member.id, application.removedRoles);
  }
  return true;
}
