import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  Guild,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config';

export type AccessLevel = 'admin' | 'mod';

function memberRoleIds(member: unknown): string[] {
  if (!member || typeof member !== 'object') return [];
  const anyMember = member as any;
  if (
    anyMember.roles &&
    anyMember.roles.cache &&
    typeof anyMember.roles.cache.keys === 'function'
  ) {
    return Array.from(anyMember.roles.cache.keys()) as string[];
  }
  if (Array.isArray(anyMember.roles)) {
    return anyMember.roles as string[];
  }
  return [];
}

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

export function getGuild(interaction: ButtonInteraction): Guild | null {
  return interaction.inGuild() ? interaction.guild : null;
}

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

export function hasCommandAccess(
  interaction: ChatInputCommandInteraction,
  required: AccessLevel,
): boolean {
  const level = commandAccessLevel(interaction);
  if (level === 'admin') return true;
  if (level === 'mod') return required === 'mod';
  return false;
}
