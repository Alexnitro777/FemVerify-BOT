import { GuildMember } from 'discord.js';
import { config } from './config';

export async function blacklistMemberRoles(
  member: GuildMember,
): Promise<{ ok: boolean; removed: string[] }> {
  const botTop = member.guild.members.me?.roles.highest.position ?? 0;
  const keep: string[] = [];
  const removed: string[] = [];

  for (const role of member.roles.cache.values()) {
    if (role.id === member.guild.id || role.id === config.roles.blacklist) continue;
    if (role.managed || role.position >= botTop) {
      keep.push(role.id);
    } else {
      removed.push(role.id);
    }
  }

  try {
    await member.roles.set([...keep, config.roles.blacklist]);
    return { ok: true, removed };
  } catch (e) {
    console.error('[roles] blacklistMemberRoles failed', e);
    return { ok: false, removed: [] };
  }
}

export async function restoreMemberRoles(member: GuildMember, roleIds: string[]): Promise<boolean> {
  const botTop = member.guild.members.me?.roles.highest.position ?? 0;
  const toAdd = roleIds.filter((id) => {
    if (id === config.roles.verified) return false;
    const role = member.guild.roles.cache.get(id);
    return role !== undefined && !role.managed && role.position < botTop;
  });

  if (toAdd.length === 0) return true;

  try {
    await member.roles.add(toAdd);
    return true;
  } catch (e) {
    console.error('[roles] restoreMemberRoles failed', e);
    return false;
  }
}
