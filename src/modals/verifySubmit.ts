import { ModalSubmitInteraction, TextChannel, MessageFlags } from 'discord.js';
import { ModalHandler } from '../types';
import { verifyQuestions } from '../questions';
import { saveApplication } from '../storage';
import { config } from '../config';
import { buildApplicationEmbed, buildReviewButtons } from '../ui';

const handler: ModalHandler = {
  customId: 'verify:submit',

  async execute(interaction: ModalSubmitInteraction): Promise<void> {
    const answers: Record<string, string> = {};
    for (const q of verifyQuestions.slice(0, 5)) {
      try {
        answers[q.id] = interaction.fields.getTextInputValue(q.id);
      } catch {
        answers[q.id] = '';
      }
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const embed = buildApplicationEmbed(interaction.user, answers);
    const buttons = buildReviewButtons(interaction.user.id);

    const channel = await interaction.client.channels.fetch(config.channels.review).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error('[verifySubmit] review channel unavailable:', config.channels.review);
      await interaction.editReply({
        content: '❌ Не удалось отправить заявку: канал модерации недоступен. Сообщите администрации.',
      });
      return;
    }

    const msg = await (channel as TextChannel)
      .send({ embeds: [embed], components: [buttons] })
      .catch((e) => {
        console.error('[verifySubmit] failed to post review message:', e);
        return null;
      });

    if (!msg) {
      await interaction.editReply({
        content: '❌ Не удалось отправить заявку модерации. Попробуйте позже или сообщите администрации.',
      });
      return;
    }

    saveApplication({
      userId: interaction.user.id,
      username: interaction.user.tag,
      guildId: interaction.guildId ?? '',
      answers,
      submittedAt: Date.now(),
      status: 'pending',
      reviewMessageUrl: msg.url,
    });

    await interaction.editReply({
      content: '✅ Анкета отправлена. Ожидайте решения модерации.',
    });
  },
};

export default handler;
