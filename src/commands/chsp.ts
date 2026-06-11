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
    .setName('выдатьчсп')
    .setDescription('Занести участника в чёрный список: снять все роли и выдать роль ЧС')
    .addUserOption((option) =>
      option.setName('цель').setDescription('Кого занести в ЧС').setRequired(true),
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

    if (user.id === interaction.user.id) {
      await interaction.reply({
        content: 'Нельзя занести в чёрный список самого себя.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`chsp:reason:${user.id}`)
      .setTitle('Укажите причину занесения в ЧС');

    const reasonInput = new TextInputBuilder()
      .setCustomId('reason')
      .setLabel('Причина занесения в ЧС')
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
