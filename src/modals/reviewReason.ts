import { ModalSubmitInteraction, MessageFlags } from 'discord.js';
import { ModalHandler, GuildConfig } from '../types';
import { hasModalAccess } from '../permissions';
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
import { logSettledFailures, runUserExclusive } from '../concurrency';
import { isMainGuild, getMainGuildInvite } from '../config';
import { applyGlobalBlacklist } from '../sync';

const handler: ModalHandler = {
  customId: /^review:reason:(reject|blacklist):\d+(?::\d+)?$/,

  async execute(interaction: ModalSubmitInteraction, gc: GuildConfig): Promise<void> {
    if (!hasModalAccess(interaction, gc, 'staff')) {
      await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
      return;
    }
    const [, , action, userId, rawNumber] = interaction.customId.split(':');
    const expectedNumber = Number(rawNumber);
    if (!rawNumber || !Number.isSafeInteger(expectedNumber) || expectedNumber <= 0) {
      await interaction.reply({ content: 'Форма устарела. Откройте её заново из актуальной анкеты.', flags: MessageFlags.Ephemeral });
      return;
    }
    const reason = interaction.fields.getTextInputValue('reason').trim();
    const guildId = interaction.guildId!;
    const guild = interaction.guild;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await runUserExclusive(userId, async () => {

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
          expectedNumber,
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

      if (isBlacklist) await applyGlobalBlacklist(interaction.client, userId, reason, interaction.user.id, guildId);
      const baseReply = isBlacklist ? 'Участник добавлен в ЧС.' : 'Заявка отклонена.';
      await interaction.editReply({
        content: blacklistWarning ? `${baseReply}\n${blacklistWarning}` : baseReply,
      });

      const reasonField = {
        title: isBlacklist ? 'Причина ЧС' : 'Причина отклонения',
        text: reason,
      };

      const isMain = isMainGuild(interaction.guildId);
      const invite = getMainGuildInvite();
      const appealTarget = isMain
        ? (gc.channels.appeal ? `<#${gc.channels.appeal}>` : 'соответствующем канале')
        : (invite ? `основном сервере проекта (${invite})` : 'основном сервере проекта');
      const appealPhrase = isMain ? `в ${appealTarget}` : `на ${appealTarget}`;

      const dmEmbed = isBlacklist
        ? buildDmEmbed(
            '🚫 Вы добавлены в чёрный список',
            `Причина: \`${reason}\`\n\nВы можете подать апелляцию ${appealPhrase}.`,
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
            ? deleteQuestionChannel(guild, claimed.questionChannelId, {
                reason: isBlacklist ? 'Выдан ЧС' : 'Заявка отклонена',
                closedByUserId: interaction.user.id,
                targetUserId: userId,
                number: claimed.number,
                reviewMessageUrl: claimed.reviewMessageUrl,
                kind: 'application',
              })
            : Promise.resolve(),
        ]),
      );
    });
  },
};

export default handler;
