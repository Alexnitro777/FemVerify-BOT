import { ModalSubmitInteraction, MessageFlags } from 'discord.js';
import { ModalHandler, GuildConfig } from '../types';
import {
  getApplication,
  claimApplication,
  setApplicationRemovedRoles,
} from '../storage';
import {
  buildDmEmbed,
  postDecisionMessage,
  markReviewMessageResolved,
} from '../ui';
import { deleteQuestionChannel } from '../channels';
import { blacklistMemberRoles } from '../roles';
import { logSettledFailures } from '../concurrency';

const handler: ModalHandler = {
  customId: /^review:reason:(reject|blacklist):\d+$/,

  async execute(interaction: ModalSubmitInteraction, gc: GuildConfig): Promise<void> {
    const [, , action, userId] = interaction.customId.split(':');
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const guildId = interaction.guildId!;
    const guild = interaction.guild;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const isBlacklist = action === 'blacklist';
    const [member, claimed] = await Promise.all([
      guild
        ? guild.members.cache.get(userId) ?? guild.members.fetch(userId).catch(() => null)
        : Promise.resolve(null),
      claimApplication(
        guildId,
        userId,
        isBlacklist ? 'blacklisted' : 'rejected',
        interaction.user.id,
        reason,
      ),
    ]);

    if (!claimed) {
      const fresh = await getApplication(guildId, userId);
      await interaction.editReply({
        content: `Заявка уже обработана (${fresh?.status ?? 'не найдена'}).`,
      });
      return;
    }

    let blacklistWarning: string | undefined;
    if (isBlacklist && member) {
      const { ok, removed } = await blacklistMemberRoles(member, gc);
      if (!ok) {
        blacklistWarning = '⚠️ Не удалось обновить роли (ЧС) — проверьте иерархию ролей бота.';
      }
      await setApplicationRemovedRoles(guildId, userId, removed);
    }

    const baseReply = isBlacklist ? 'Участник добавлен в ЧС.' : 'Заявка отклонена.';
    await interaction.editReply({
      content: blacklistWarning ? `${baseReply}\n${blacklistWarning}` : baseReply,
    });

    const reasonField = {
      title: isBlacklist ? 'Причина ЧС' : 'Причина отклонения',
      text: reason,
    };

    const dmEmbed = isBlacklist
      ? buildDmEmbed(
          '🚫 Вы добавлены в чёрный список',
          `Причина: \`${reason}\`\n\nВы можете подать апелляцию в ${
            gc.channels.appeal ? `<#${gc.channels.appeal}>` : 'соответствующем канале'
          }.`,
          0x992d22,
        )
      : buildDmEmbed(
          '❌ Заявка отклонена',
          `Причина: \`${reason}\`\n\nВы можете подать новую заявку.`,
          0xed4245,
        );

    logSettledFailures(
      'reviewReason',
      await Promise.allSettled([
        member?.send({ embeds: [dmEmbed] }).catch(() => null) ?? Promise.resolve(null),
        markReviewMessageResolved(interaction.client, claimed.reviewMessageUrl, {
          kind: 'application',
          label: isBlacklist ? 'ЧС' : 'Отклонено',
          color: isBlacklist ? 0x992d22 : 0xed4245,
          reviewerId: interaction.user.id,
          reason: reasonField,
        }),
        postDecisionMessage(interaction.client, gc.channels.decisions, 'application', {
          label: isBlacklist ? 'ЧС' : 'Отклонено',
          color: isBlacklist ? 0x992d22 : 0xed4245,
          reviewerId: interaction.user.id,
          targetUserId: userId,
          reviewMessageUrl: claimed.reviewMessageUrl,
          reason: reasonField,
          number: claimed.number,
        }),
        guild
          ? deleteQuestionChannel(guild, claimed.questionChannelId, 'Заявка обработана')
          : Promise.resolve(),
      ]),
    );
  },
};

export default handler;
