import { Client, Events, GuildMember, PartialGuildMember } from 'discord.js';
import { getGuildConfig } from './guildConfig';
import { getSpecialBlacklist } from './storage';

export async function enforceChsaProtection(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  if (member.user.bot) return;

  const full = member.partial ? await member.fetch().catch(() => null) : member;
  if (!full) return;

  const gc = await getGuildConfig(full.guild.id);
  if (!gc || !gc.roles.blacklistA) return;

  const chsaRole = gc.roles.blacklistA;
  const isChsaInDb = await getSpecialBlacklist(full.guild.id, full.id, 'ЧСА').catch(() => null);

  if (!isChsaInDb) return;

  const adminRoleIds = new Set([...gc.roles.staff, ...gc.roles.ststaff]);
  const hasChsaRole = full.roles.cache.has(chsaRole);
  const adminRolesToRemove = full.roles.cache.filter((r) => adminRoleIds.has(r.id));

  // 1. Восстановить роль ЧСА, если её сняли вручную в Discord
  if (!hasChsaRole) {
    try {
      await full.roles.add(chsaRole, 'ЧСА: автоматический возврат роли ЧС администрации');
      console.log(`[chsaProtection] Восстановлена роль ЧСА для ${full.user.tag} (${full.id})`);
    } catch (e) {
      console.error(`[chsaProtection] Не удалось восстановить роль ЧСА для ${full.id}:`, e);
    }
  }

  // 2. Снять роли администрации, если их попытались выдать участнику с ЧСА
  if (adminRolesToRemove.size > 0) {
    try {
      await full.roles.remove(
        adminRolesToRemove.map((r) => r.id),
        'ЧСА: запрет на получение ролей администрации',
      );
      console.log(
        `[chsaProtection] Сняты роли администрации у ${full.user.tag} (${full.id}): ${adminRolesToRemove.map((r) => r.name).join(', ')}`,
      );
    } catch (e) {
      console.error(
        `[chsaProtection] Не удалось снять роли администрации у ${full.id}:`,
        e,
      );
    }
  }
}

export function registerChsaProtection(client: Client): void {
  client.on(Events.GuildMemberUpdate, (_oldMember, newMember) => {
    void enforceChsaProtection(newMember).catch((e) =>
      console.error('[chsaProtection] guildMemberUpdate error:', e),
    );
  });
}
