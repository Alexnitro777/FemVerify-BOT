import { Client, Events, GuildMember, PartialGuildMember } from 'discord.js';
import { getGuildConfig } from './guildConfig';
import { getSpecialBlacklist, getApplication } from './storage';

export async function enforceChsaProtection(
  member: GuildMember | PartialGuildMember,
): Promise<void> {
  if (member.user.bot) return;

  const full = member.partial ? await member.fetch().catch(() => null) : member;
  if (!full) return;

  const gc = await getGuildConfig(full.guild.id);
  if (!gc) return;

  // 1. Защита ЧСА
  if (gc.roles.blacklistA) {
    const chsaRole = gc.roles.blacklistA;
    const isChsaInDb = await getSpecialBlacklist(full.guild.id, full.id, 'ЧСА').catch(() => null);

    if (isChsaInDb) {
      const adminRoleIds = new Set([...gc.roles.staff, ...gc.roles.ststaff]);
      const hasChsaRole = full.roles.cache.has(chsaRole);
      const adminRolesToRemove = full.roles.cache.filter((r) => adminRoleIds.has(r.id));

      // Восстановить роль ЧСА, если её сняли вручную в Discord
      if (!hasChsaRole) {
        try {
          await full.roles.add(chsaRole, 'ЧСА: автоматический возврат роли ЧС администрации');
          console.log(`[chsaProtection] Восстановлена роль ЧСА для ${full.user.tag} (${full.id})`);
        } catch (e) {
          console.error(`[chsaProtection] Не удалось восстановить роль ЧСА для ${full.id}:`, e);
        }
      }

      // Снять роли администрации, если их попытались выдать участнику с ЧСА
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
  }

  // 2. Защита ЧСЗ
  if (gc.roles.blacklistZ) {
    const chszRole = gc.roles.blacklistZ;
    const isChszInDb = await getSpecialBlacklist(full.guild.id, full.id, 'ЧСЗ').catch(() => null);

    if (isChszInDb && !full.roles.cache.has(chszRole)) {
      try {
        await full.roles.add(chszRole, 'ЧСЗ: автоматический возврат роли ЧС знакомств');
        console.log(`[chsaProtection] Восстановлена роль ЧСЗ для ${full.user.tag} (${full.id})`);
      } catch (e) {
        console.error(`[chsaProtection] Не удалось восстановить роль ЧСЗ для ${full.id}:`, e);
      }
    }
  }

  // 3. Защита ЧСП
  if (gc.roles.blacklist) {
    const chspRole = gc.roles.blacklist;
    const app = await getApplication(full.guild.id, full.id).catch(() => null);
    const isChspInDb = app?.status === 'blacklisted';

    if (isChspInDb && !full.roles.cache.has(chspRole)) {
      try {
        await full.roles.add(chspRole, 'ЧСП: автоматический возврат роли чёрного списка');
        console.log(`[chsaProtection] Восстановлена роль ЧСП для ${full.user.tag} (${full.id})`);
      } catch (e) {
        console.error(`[chsaProtection] Не удалось восстановить роль ЧСП для ${full.id}:`, e);
      }
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
