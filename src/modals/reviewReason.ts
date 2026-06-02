import { ModalSubmitInteraction, EmbedBuilder, TextChannel, MessageFlags } from 'discord.js';
import { ModalHandler } from '../types';
import { config } from '../config';
import { getApplication, claimApplication, updateApplication } from '../storage';
import { buildResolvedEmbed, buildDmEmbed, postDecisionMessage, buildProcessedButtonRow } from '../ui';

const handler: ModalHandler = {
  customId: /^review:reason:(reject|blacklist):\d+$/,

  async execute(interaction: ModalSubmitInteraction): Promise<void> {
    const [, , action, userId] = interaction.customId.split(':');
    const reason = interaction.fields.getTextInputValue('reason').trim();

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const app = getApplication(userId);
    if (!app) {
      await interaction.editReply({ content: 'Заявка не найдена.' });
      return;
    }

    const newStatus = action === 'blacklist' ? 'blacklisted' : 'rejected';
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

    let blacklistWarning: string | undefined;
    if (action === 'blacklist') {
      if (member) {
        const added = await member.roles
          .add(config.roles.blacklist)
          .then(() => true)
          .catch((e) => {
            console.error('[reviewReason] roles.add blacklist failed', e);
            return false;
          });
        if (!added) {
          blacklistWarning = '⚠️ Не удалось выдать роль ЧС — проверьте иерархию ролей бота.';
        }
      }
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

    if (app.reviewMessageUrl) {
      const parsed = app.reviewMessageUrl.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
      if (parsed) {
        const [, , channelId, messageId] = parsed;
        const reviewChannel = await interaction.client.channels.fetch(channelId).catch(() => null);
        if (reviewChannel?.isTextBased()) {
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
    }

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

    if (app.questionChannelId) {
      const questionChannel = await interaction.guild?.channels
        .fetch(app.questionChannelId)
        .catch(() => null);
      await questionChannel?.delete().catch((e) => {
        console.error('[reviewReason] failed to delete question channel', e);
        return null;
      });
      updateApplication(userId, { questionChannelId: undefined });
    }

    const baseReply = action === 'blacklist' ? 'Участник добавлен в ЧС.' : 'Заявка отклонена.';
    await interaction.editReply({
      content: blacklistWarning ? `${baseReply}\n${blacklistWarning}` : baseReply,
    });
  },
};

export default handler;
