import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  Guild,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config';

export type AccessLevel = 'admin' | 'mod';

/**
 * Достаёт id ролей участника как из объекта GuildMember (roles.cache),
 * так и из «сырых» данных API (member.roles — массив строк).
 */
function memberRoleIds(member: unknown): string[] {
  if (!member || typeof member !== 'object') return [];
  const anyMember = member as any;
  // GuildMember: roles — менеджер с cache (Collection).
  if (
    anyMember.roles &&
    anyMember.roles.cache &&
    typeof anyMember.roles.cache.keys === 'function'
  ) {
    return Array.from(anyMember.roles.cache.keys()) as string[];
  }
  // Сырые данные API: roles — массив id.
  if (Array.isArray(anyMember.roles)) {
    return anyMember.roles as string[];
  }
  return [];
}

/**
 * Проверяет, что взаимодействие пришло из гильдии и автор — модератор
 * (имеет право ManageRoles, либо роль модератора/админа из конфига).
 */
export function isMod(interaction: ButtonInteraction): boolean {
  if (!interaction.inGuild()) return false;
  const member = interaction.member as GuildMember | null;
  if (!member) return false;
  const roleIds = memberRoleIds(member);
  return (
    member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    config.roles.mod.some((roleId) => roleIds.includes(roleId)) ||
    config.roles.admin.some((roleId) => roleIds.includes(roleId))
  );
}

/**
 * Безопасно достаёт гильдию из взаимодействия.
 * @returns Guild или null, если взаимодействие вне сервера.
 */
export function getGuild(interaction: ButtonInteraction): Guild | null {
  return interaction.inGuild() ? interaction.guild : null;
}

/**
 * Определяет уровень доступа автора слэш-команды по ролям из конфига.
 * - 'admin' — есть право Administrator или роль из roles.admin.
 * - 'mod'   — есть роль из roles.mod.
 * - null    — доступа нет.
 */
export function commandAccessLevel(
  interaction: ChatInputCommandInteraction,
): AccessLevel | null {
  const roleIds = memberRoleIds(interaction.member);

  const isAdmin =
    (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ??
      false) ||
    config.roles.admin.some((roleId) => roleIds.includes(roleId));
  if (isAdmin) return 'admin';

  if (config.roles.mod.some((roleId) => roleIds.includes(roleId))) return 'mod';

  return null;
}

/**
 * Проверяет, есть ли у автора доступ к команде требуемого уровня.
 * Админ имеет доступ ко всем командам; модератор — только к mod-командам.
 */
export function hasCommandAccess(
  interaction: ChatInputCommandInteraction,
  required: AccessLevel,
): boolean {
  const level = commandAccessLevel(interaction);
  if (level === 'admin') return true;
  if (level === 'mod') return required === 'mod';
  return false;
}
