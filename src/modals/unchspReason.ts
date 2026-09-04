import { ModalSubmitInteraction, GuildMember, MessageFlags } from 'discord.js';
import { ModalHandler, GuildConfig } from '../types';
import { getApplication, amnestyApplication, claimAppeal } from '../storage';
import { buildDmEmbed, postDecisionMessage, markReviewMessageResolved } from '../ui';
import { deleteQuestionChannel } from '../channels';
import { restoreMemberRoles } from '../roles';
import { canManageByHierarchy, canManageRoles } from '../permissions';
import { removeGlobalBlacklist } from '../sync';
import { logSettledFailures } from '../concurrency';

const handler: ModalHandler = {
  customId: /^unchsp:reason:\d+$/,

  async execute(interaction: ModalSubmitInteraction, gc: GuildConfig): Promise<void> {
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

    const guild = interaction.guild;
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

    if (!isBlacklistedInGuild && !isBlacklistedInDb) {
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

    const warnings: string[] = [];

    if (member) {
      const roleRemoved = await member.roles
        .remove(gc.roles.blacklist)
        .then(() => true)
        .catch((e) => {
          console.error('[unchspReason] roles.remove failed', e);
          return false;
        });
      if (!roleRemoved) {
        warnings.push('⚠️ Не удалось снять роль ЧС — проверьте иерархию ролей бота.');
      }

      if (toRestore.length > 0) {
        const restored = await restoreMemberRoles(member, gc, toRestore);
        if (!restored) {
          warnings.push('⚠️ Не удалось вернуть часть ролей — проверьте иерархию ролей бота.');
        }
      }
    }

    const [claimedAppeal] = await Promise.all([
      claimAppeal(guildId, userId, 'amnestied', interaction.user.id, reason),
      existing ? amnestyApplication(guildId, userId) : Promise.resolve(),
    ]);

    const baseReply = `Участник <@${userId}> снят с ЧС.`;
    await interaction.editReply({
      content: warnings.length ? `${baseReply}\n${warnings.join('\n')}` : baseReply,
    });

    void removeGlobalBlacklist(interaction.client, userId, guildId).catch((e) =>
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
        claimedAppeal
          ? markReviewMessageResolved(interaction.client, claimedAppeal.reviewMessageUrl, {
              kind: 'appeal',
              label: 'Амнистия принята',
              color: 0x57f287,
              reviewerId: interaction.user.id,
            })
          : Promise.resolve(),
        claimedAppeal
          ? deleteQuestionChannel(guild, claimedAppeal.questionChannelId, 'Снятие ЧСП')
          : Promise.resolve(),
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
  },
};

export default handler;
