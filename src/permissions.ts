import {
  ButtonInteraction,
  GuildMember,
  Guild,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config';

/**
 * Проверяет, что взаимодействие пришло из гильдии и автор — модератор
 * (имеет право ManageRoles или роль модератора).
 */
export function isMod(interaction: ButtonInteraction): boolean {
  if (!interaction.inGuild()) return false;
  const member = interaction.member as GuildMember | null;
  if (!member) return false;
  return (
    member.permissions.has(PermissionFlagsBits.ManageRoles) ||
    config.roles.mod.some((roleId) => member.roles.cache.has(roleId))
  );
}

/**
 * Безопасно достаёт гильдию из взаимодействия.
 * @returns Guild или null, если взаимодействие вне сервера.
 */
export function getGuild(interaction: ButtonInteraction): Guild | null {
  return interaction.inGuild() ? interaction.guild : null;
}
