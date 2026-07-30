import { Client, GuildMember, PartialGuildMember } from 'discord.js';
import { isUserGloballyVerified } from './storage';
import { getGuildConfig } from './guildConfig';

async function enforceVerificationOnJoin(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  if (member.user.bot) return;

  const full = member.partial ? await member.fetch().catch(() => null) : member;
  if (!full) return;

  const gc = await getGuildConfig(full.guild.id);
  if (!gc) return;

  const isVerified = await isUserGloballyVerified(full.id);
  if (!isVerified) return;

  if (full.roles.cache.has(gc.roles.verified)) return;

  try {
    await full.roles.add(gc.roles.verified, 'Автоматическая верификация (глобальная)');
    console.log(`[verificationEnforce] выдана роль верификации ${full.user.tag} (${full.id})`);
  } catch (e) {
    console.error(`[verificationEnforce] не удалось выдать роль верификации для ${full.id}:`, e);
  }
}

export function registerVerificationEnforcement(client: Client): void {
  client.on('guildMemberAdd', (member) => {
    void enforceVerificationOnJoin(member).catch((e) =>
      console.error('[verificationEnforce] handler failed', e),
    );
  });
}
