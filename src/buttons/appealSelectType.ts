import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  MessageFlags,
} from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import { appealQuestions } from '../questions';
import { isMainGuild, getMainGuildInvite } from '../config';

const handler: ButtonHandler = {
  customId: /^appeal:select_type:(.+)$/,

  async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
    if (!isMainGuild(interaction.guildId)) {
      const invite = getMainGuildInvite();
      const content = invite
        ? `Подать апелляцию можно только на основном сервере проекта: ${invite}`
        : 'Подать апелляцию можно только на основном сервере проекта.';
      await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const [, type] = interaction.customId.split('select_type:');

    const modal = new ModalBuilder().setCustomId(`appeal:submit:${type}`).setTitle(`Апелляция: ${type}`);
    const rows = appealQuestions.slice(0, 5).map((q) => {
      const input = new TextInputBuilder()
        .setCustomId(q.id)
        .setLabel(q.label)
        .setStyle(q.style)
        .setRequired(q.required);
      if (q.minLength) input.setMinLength(q.minLength);
      if (q.maxLength) input.setMaxLength(q.maxLength);
      if (q.placeholder) input.setPlaceholder(q.placeholder);
      return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    });
    modal.addComponents(...rows);
    await interaction.showModal(modal);
  },
};

export default handler;
