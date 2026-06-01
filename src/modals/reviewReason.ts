import { ModalSubmitInteraction, EmbedBuilder, TextChannel, MessageFlags } from 'discord.js';
import { ModalHandler } from '../types';
import { config } from '../config';
import { getApplication, claimApplication } from '../storage';
import { buildResolvedEmbed, buildDmEmbed, postDecisionMessage, buildProcessedButtonRow } from '../ui';

// review:reason:<reject|blacklist>:<userId>
const handler: ModalHandler = {
  customId: /^review:reason:(reject|blacklist):\d+$/,

  async execute(interaction: ModalSubmitInteraction): Promise<void> {
    const [, , action, userId] = interaction.customId.split(':');
    const reason = interaction.fields.getTextInputValue('reason').trim();

    // Деферим заранее: дальше идут сетевые вызовы (баг #1).
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const app = getApplication(userId);
    if (!app) {
      await interaction.editReply({ content: 'Заявка не найдена.' });
      return;
    }

    const newStatus = action === 'blacklist' ? 'blacklisted' : 'rejected';
    // Атомарно переводим из pending — защита от двойной обработки.
    const claimed = claimApplication(userId, newStatus, interaction.user.id, reason);
    if (!claimed) {
      const fresh = getApplication(userId);
      await interaction.editReply({
        content: `Заявка уже обработана (${fresh?.status ?? 'не найдена'}).`,
      });
      return;
    }

    const guild = interaction.guild;
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;

    if (action === 'blacklist') {
      await member?.roles.add(config.roles.blacklist).catch(() => null);
      await member
        ?.send({
          embeds: [
            buildDmEmbed(
              '🚫 Вы добавлены в чёрный список',
              `Причина: ${reason}\n\nВы можете подать аппеляцию в ${
                config.channels.appeal ? `<#${config.channels.appeal}>` : 'соответствующем канале'
              }.`,
              0x992d22,
            ),
          ],
        })
        .catch(() => null);
    } else {
      await member
        ?.send({
          embeds: [
            buildDmEmbed(
              '❌ Заявка отклонена',
              `Причина: ${reason}\n\nВы можете подать новую заявку.`,
              0xed4245,
            ),
          ],
        })
        .catch(() => null);
    }

    // Обновляем исходное сообщение заявки в канале модерации
    if (app.reviewMessageUrl) {
      const reviewChannel = await interaction.client.channels.fetch(config.channels.review).catch(() => null);
      if (reviewChannel?.isTextBased()) {
        const messageId = app.reviewMessageUrl.split('/').pop()!;
        const msg = await (reviewChannel as TextChannel).messages.fetch(messageId).catch(() => null);
        if (msg && msg.embeds[0]) {
          const resolved = buildResolvedEmbed(
            EmbedBuilder.from(msg.embeds[0]),
            action === 'blacklist' ? 'ЧС' : 'Отклонено',
            action === 'blacklist' ? 0x992d22 : 0xed4245,
            interaction.user.id,
          );
          await msg
            .edit({ embeds: [resolved], components: [buildProcessedButtonRow('application')] })
            .catch(() => null);
        }
      }
    }

    // Отдельное сообщение-решение в канал решений (со ссылкой на анкету, без причины).
    await postDecisionMessage(interaction.client, config.channels.decisions, 'application', {
      label: action === 'blacklist' ? 'ЧС' : 'Отклонено',
      color: action === 'blacklist' ? 0x992d22 : 0xed4245,
      reviewerId: interaction.user.id,
      targetUserId: userId,
      reviewMessageUrl: app.reviewMessageUrl,
      reason: {
        title: action === 'blacklist' ? 'Причина ЧС' : 'Причина отклонения',
        text: reason,
      },
    });

    // После решения удаляем приватный канал-вопрос этого участника, если он создавался.
    if (app.questionChannelId) {
      const questionChannel = await interaction.guild?.channels
        .fetch(app.questionChannelId)
        .catch(() => null);
      await questionChannel?.delete().catch((e) => {
        console.error('[reviewReason] failed to delete question channel', e);
        return null;
      });
    }

    await interaction.editReply({
      content: action === 'blacklist' ? 'Участник добавлен в ЧС.' : 'Заявка отклонена.',
    });
  },
};

export default handler;
