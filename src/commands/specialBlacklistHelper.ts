import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { SlashCommand, GuildConfig } from '../types';
import { canManageByHierarchy } from '../permissions';

function getRoleAndName(gc: GuildConfig, type: 'ЧСЗ' | 'ЧСА') {
  if (type === 'ЧСЗ') {
    return { roleId: gc.roles.blacklistZ, name: 'ЧС знакомств' };
  }
  return { roleId: gc.roles.blacklistA, name: 'ЧС администрации' };
}

export function buildSpecialBlacklistCommand(type: 'ЧСЗ' | 'ЧСА', action: 'add' | 'remove'): SlashCommand {
  const isAdd = action === 'add';
  const cmdName = isAdd ? (type === 'ЧСЗ' ? 'выдатьчсз' : 'выдатьчса') : (type === 'ЧСЗ' ? 'снятьчсз' : 'снятьчса');
  const actionDesc = isAdd ? 'Занести участника в' : 'Снять участника с';
  const roleName = type === 'ЧСЗ' ? 'ЧС знакомств' : 'ЧС администрации';
  const targetDesc = isAdd ? 'Кого занести в' : 'Кому снять';

  return {
    data: new SlashCommandBuilder()
      .setName(cmdName)
      .setDescription(`${actionDesc} ${roleName}`)
      .addUserOption((opt) => opt.setName('цель').setDescription(`${targetDesc} ${roleName}`).setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames) as unknown as SlashCommand['data'],

    access: 'ststaff',

    async execute(interaction: ChatInputCommandInteraction, gc: GuildConfig): Promise<void> {
      if (!interaction.inGuild() || !interaction.guild) {
        await interaction.reply({
          content: 'Команду нужно запускать на сервере.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const { roleId, name } = getRoleAndName(gc, type);
      if (!roleId) {
        await interaction.reply({
          content: `Роль для ${name} (${type}) не настроена на этом сервере.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const user = interaction.options.getUser('цель', true);
      if (user.id === interaction.user.id) {
        await interaction.reply({
          content: `Нельзя ${isAdd ? 'занести в' : 'снять с'} ${type} самого себя.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const [target, moderator] = await Promise.all([
        interaction.guild.members.cache.get(user.id) ??
          interaction.guild.members.fetch(user.id).catch(() => null),
        interaction.guild.members.cache.get(interaction.user.id) ??
          interaction.guild.members.fetch(interaction.user.id).catch(() => null),
      ]);

      const hasRole = target?.roles.cache.has(roleId);
      if (isAdd && hasRole) {
        await interaction.reply({
          content: `Участник уже находится в ${name}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (!isAdd && target && !hasRole) {
        await interaction.reply({
          content: `Участник не имеет роли ${name}.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (target && moderator && !canManageByHierarchy(moderator as GuildMember, target)) {
        await interaction.reply({
          content: `Нельзя ${isAdd ? 'занести в' : 'снять с'} ${name} участника, чья роль выше вашей или равна ей.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId(`special_bl:${action}:${type}:${user.id}`)
        .setTitle(isAdd ? `Причина занесения в ${type}` : `Причина снятия ${type}`);

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel(isAdd ? `Причина занесения в ${type}` : `Причина снятия ${type}`)
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput));
      await interaction.showModal(modal);
    },
  };
}
