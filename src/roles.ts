import { GuildMember } from 'discord.js';
import { config } from './config';

export async function blacklistMemberRoles(member: GuildMember): Promise<boolean> {
  const botTop = member.guild.members.me?.roles.highest.position ?? 0;
  const keep = member.roles.cache
    .filter((role) => role.id !== member.guild.id && (role.managed || role.position >= botTop))
    .map((role) => role.id);
  try {
    await member.roles.set([...keep, config.roles.blacklist]);
    return true;
  } catch (e) {
    console.error('[roles] blacklistMemberRoles failed', e);
    return false;
  }
}
