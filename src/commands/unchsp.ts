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
import { getApplication } from '../storage';
import { canManageByHierarchy, canManageRoles } from '../permissions';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('снятьчсп')
    .setDescription('Снять участника с чёрного списка: убрать роль ЧС и вернуть снятые роли')
    .addUserOption((option) =>
      option.setName('цель').setDescription('Кому снять ЧС').setRequired(true),
    )
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

    const user = interaction.options.getUser('цель', true);

    if (user.id === interaction.user.id) {
      await interaction.reply({
        content: 'Нельзя снять с чёрного списка самого себя.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [target, moderator, existing] = await Promise.all([
      interaction.guild.members.cache.get(user.id) ??
        interaction.guild.members.fetch(user.id).catch(() => null),
      interaction.guild.members.cache.get(interaction.user.id) ??
        interaction.guild.members.fetch(interaction.user.id).catch(() => null),
      getApplication(interaction.guild.id, user.id),
    ]);

    if (target && !target.roles.cache.has(gc.roles.blacklist)) {
      await interaction.reply({
        content: 'Участник не находится в чёрном списке.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (target && moderator) {
      const toRestore = existing?.removedRoles ?? [];
      if (
        !canManageByHierarchy(moderator as GuildMember, target) ||
        !canManageRoles(moderator as GuildMember, toRestore)
      ) {
        await interaction.reply({
          content: 'Нельзя снять с чёрного списка участника, чьи роли выше ваших или равны им.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const modal = new ModalBuilder()
      .setCustomId(`unchsp:reason:${user.id}`)
      .setTitle('Укажите причину снятия ЧС');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина снятия ЧС')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(reasonInput),
    );

    await interaction.showModal(modal);
  },
};

export default command;
