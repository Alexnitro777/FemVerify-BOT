import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { ButtonHandler } from '../types';
import { verifyQuestions } from '../questions';
import { getApplication } from '../storage';
import { config } from '../config';

const handler: ButtonHandler = {
  customId: 'verify:start',

  async execute(interaction: ButtonInteraction): Promise<void> {
    const member = interaction.member as GuildMember | null;
    if (member && member.roles.cache.has(config.roles.blacklist)) {
      await interaction.reply({
        content: 'Вы находитесь в чёрном списке. Используйте канал аппеляции.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = getApplication(interaction.user.id);
    if (existing?.status === 'pending') {
      await interaction.reply({ content: 'Ваша заявка уже на рассмотрении.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (existing?.status === 'approved' && member?.roles.cache.has(config.roles.verified)) {
      await interaction.reply({ content: 'Вы уже верифицированы.', flags: MessageFlags.Ephemeral });
      return;
    }

    const modal = new ModalBuilder().setCustomId('verify:submit').setTitle('Анкета верификации');

    const rows = verifyQuestions.slice(0, 5).map((q) => {
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
