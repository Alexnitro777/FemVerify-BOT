import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';
import { SlashCommand } from '../types';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('снятьчсп')
    .setDescription('Снять участника с чёрного списка: убрать роль ЧС и вернуть снятые роли')
    .addUserOption((option) =>
      option.setName('цель').setDescription('Кого снять с ЧС').setRequired(true),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames) as unknown as SlashCommand['data'],

  access: 'mod',

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Команду нужно запускать на сервере.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = interaction.options.getUser('цель', true);

    const modal = new ModalBuilder()
      .setCustomId(`unchsp:reason:${user.id}`)
      .setTitle('Укажите причину снятия с ЧС');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина снятия с ЧС')
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
