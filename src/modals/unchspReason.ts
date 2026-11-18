import { ModalSubmitInteraction, GuildMember, MessageFlags } from 'discord.js';
import { ModalHandler, GuildConfig } from '../types';
import { getApplication, amnestyApplication, claimAppeal, getPendingAppeals } from '../storage';
import { buildDmEmbed, postDecisionMessage, markReviewMessageResolved } from '../ui';
import { deleteQuestionChannel } from '../channels';
import { liftProjectBlacklist } from '../roles';
import { canManageByHierarchy, canManageRoles, hasModalAccess } from '../permissions';
import { removeGlobalBlacklist } from '../sync';
import { logSettledFailures, runUserExclusive } from '../concurrency';

const handler: ModalHandler = {
  customId: /^unchsp:reason:\d+$/,

  async execute(interaction: ModalSubmitInteraction, gc: GuildConfig): Promise<void> {
    if (!hasModalAccess(interaction, gc, 'ststaff')) {
      await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
      return;
    }
    const [, , userId] = interaction.customId.split(':');
    const reason = interaction.fields.getTextInputValue('reason').trim();

    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Команду нужно запускать на сервере.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!reason) {
      await interaction.reply({
        content: 'Укажите причину снятия ЧС.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await runUserExclusive(userId, async () => {

      const guild = interaction.guild!;
      const guildId = guild.id;

      const [user, member, moderator, existing] = await Promise.all([
        interaction.client.users.fetch(userId).catch(() => null),
        guild.members.cache.get(userId) ?? guild.members.fetch(userId).catch(() => null),
        guild.members.cache.get(interaction.user.id) ??
          guild.members.fetch(interaction.user.id).catch(() => null),
        getApplication(guildId, userId),
      ]);

      if (!user) {
        await interaction.editReply({ content: 'Пользователь не найден в Discord.' });
        return;
      }

      const isBlacklistedInGuild = member?.roles.cache.has(gc.roles.blacklist);
      const isBlacklistedInDb = existing?.status === 'blacklisted';

      if (!isBlacklistedInGuild && !isBlacklistedInDb && !existing?.removedRoles?.length) {
        await interaction.editReply({ content: 'Участник не находится в чёрном списке.' });
        return;
      }

      const toRestore = existing?.removedRoles ?? [];
      if (member) {
        if (
          !moderator ||
          !canManageByHierarchy(moderator as GuildMember, member) ||
          !canManageRoles(moderator as GuildMember, toRestore)
        ) {
          await interaction.editReply({
            content: 'Нельзя снять с чёрного списка участника, чьи роли выше ваших или равны им.',
          });
          return;
        }
      }

      const pending = (await getPendingAppeals(guildId, userId))
        .filter((appeal) => (appeal.blacklistType ?? 'ЧСП') === 'ЧСП');
      const claimedAppeals = [];
      for (const appeal of pending) {
        const claimed = await claimAppeal(guildId, userId, 'amnestied', interaction.user.id, reason, Date.now(), 'ЧСП', appeal.id);
        if (claimed) claimedAppeals.push(claimed);
      }
      if (existing) await amnestyApplication(guildId, userId);
      const warnings: string[] = [];
      if (member && !(await liftProjectBlacklist(member, gc))) {
        warnings.push('⚠️ Не удалось снять ЧС или вернуть все роли. Снимок ролей сохранён для повторной попытки.');
      }

      const baseReply = `Участник <@${userId}> снят с ЧС.`;
      await interaction.editReply({
        content: warnings.length ? `${baseReply}\n${warnings.join('\n')}` : baseReply,
      });

      await removeGlobalBlacklist(interaction.client, userId, guildId).catch((e) =>
        console.error('[unchspReason] removeGlobalBlacklist failed', e),
      );

      logSettledFailures(
        'unchspReason',
        await Promise.allSettled([
          user
            .send({
              embeds: [
                buildDmEmbed(
                  '✅ С вас снят чёрный список',
                  'Модерация сняла вас с чёрного списка. Вы можете снова пользоваться сервером.',
                  0x57f287,
                ),
              ],
            })
            .catch(() => null),
          ...claimedAppeals.flatMap((claimedAppeal) => [
            markReviewMessageResolved(interaction.client, claimedAppeal.reviewMessageUrl, {
              kind: 'appeal', label: 'Амнистия принята', color: 0x57f287, reviewerId: interaction.user.id,
            }),
            deleteQuestionChannel(guild, claimedAppeal.questionChannelId, {
              reason: 'Снятие ЧСП', targetUserId: userId, kind: 'appeal',
              number: claimedAppeal.number, reviewMessageUrl: claimedAppeal.reviewMessageUrl,
            }),
          ]),
          postDecisionMessage(interaction.client, gc.channels.blacklistLog, 'application', {
            label: 'Снят с ЧС',
            color: 0x57f287,
            reviewerId: interaction.user.id,
            targetUserId: userId,
            reason: { title: 'Причина снятия ЧС', text: reason },
            number: existing?.number,
            title: 'Снятие ЧСП',
          }),
        ]),
      );
    });
  },
};

export default handler;
