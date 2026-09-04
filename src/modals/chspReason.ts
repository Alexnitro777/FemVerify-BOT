import { ModalSubmitInteraction, GuildMember, MessageFlags } from 'discord.js';
import { ModalHandler, GuildConfig } from '../types';
import { getApplication, upsertBlacklistedApplication } from '../storage';
import { buildDmEmbed, postDecisionMessage, markReviewMessageResolved } from '../ui';
import { deleteQuestionChannel } from '../channels';
import { blacklistMemberRoles } from '../roles';
import { canManageByHierarchy } from '../permissions';
import { applyGlobalBlacklist } from '../sync';
import { logSettledFailures } from '../concurrency';

const handler: ModalHandler = {
  customId: /^chsp:reason:\d+$/,

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
        content: 'Укажите причину занесения в ЧС.',
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

    if (member && member.roles.cache.has(gc.roles.blacklist)) {
      await interaction.editReply({ content: 'Участник уже находится в чёрном списке на сервере.' });
      return;
    }
    if (existing?.status === 'blacklisted') {
      await interaction.editReply({ content: 'Участник уже находится в чёрном списке в базе данных.' });
      return;
    }

    if (member && (!moderator || !canManageByHierarchy(moderator as GuildMember, member))) {
      await interaction.editReply({
        content: 'Нельзя занести в чёрный список участника, чья роль выше вашей или равна ей.',
      });
      return;
    }

    let rolesOk = true;
    let removed: string[] = [];
    if (member) {
      const res = await blacklistMemberRoles(member, gc);
      rolesOk = res.ok;
      removed = res.removed;
    }

    await upsertBlacklistedApplication({
      guildId,
      userId,
      username: user.tag,
      reason,
      reviewerId: interaction.user.id,
      removedRoles: removed,
    });

    const baseReply = `Участник <@${userId}> добавлен в ЧС.`;
    await interaction.editReply({
      content: rolesOk
        ? baseReply
        : `${baseReply}\n⚠️ Не удалось снять все роли — проверьте иерархию ролей бота.`,
    });

    void applyGlobalBlacklist(interaction.client, userId, reason, interaction.user.id, guildId).catch(
      (e) => console.error('[chspReason] applyGlobalBlacklist failed', e),
    );

    const wasOpen = existing?.status === 'pending' || existing?.status === 'amnestied';

    logSettledFailures(
      'chspReason',
      await Promise.allSettled([
        user
          .send({
            embeds: [
              buildDmEmbed(
                '🚫 Вы добавлены в чёрный список',
                `Причина: \`${reason}\`\n\nВы можете подать апелляцию в ${
                  gc.channels.appeal ? `<#${gc.channels.appeal}>` : 'соответствующем канале'
                }.`,
                0x992d22,
              ),
            ],
          })
          .catch(() => null),
        wasOpen
          ? markReviewMessageResolved(interaction.client, existing?.reviewMessageUrl, {
              kind: 'application',
              label: 'ЧС',
              color: 0x992d22,
              reviewerId: interaction.user.id,
              reason: { title: 'Причина ЧС', text: reason },
            })
          : Promise.resolve(),
        deleteQuestionChannel(guild, existing?.questionChannelId, 'Выдача ЧСП'),
        postDecisionMessage(interaction.client, gc.channels.blacklistLog, 'application', {
          label: 'ЧС',
          color: 0x992d22,
          reviewerId: interaction.user.id,
          targetUserId: userId,
          reason: { title: 'Причина ЧС', text: reason },
          number: existing?.number,
          title: 'Выдача ЧСП',
        }),
      ]),
    );
  },
};

export default handler;
