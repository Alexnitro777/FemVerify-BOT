import { ModalSubmitInteraction, GuildMember, MessageFlags } from 'discord.js';
import { ModalHandler, GuildConfig } from '../types';
import { getApplication, updateApplication } from '../storage';
import { buildDmEmbed, postDecisionMessage } from '../ui';
import { restoreMemberRoles } from '../roles';
import { canManageByHierarchy, canManageRoles } from '../permissions';

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
        content: 'Укажите причину снятия с ЧС.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const guildId = interaction.guild.id;
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: 'Пользователь не найден на сервере.' });
      return;
    }

    if (!member.roles.cache.has(gc.roles.blacklist)) {
      await interaction.editReply({ content: 'Участник не находится в чёрном списке.' });
      return;
    }

    const moderator = await interaction.guild.members
      .fetch(interaction.user.id)
      .catch(() => null);
    const existing = await getApplication(guildId, userId);
    const toRestore = existing?.removedRoles ?? [];
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

    const warnings: string[] = [];

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
      await updateApplication(guildId, userId, { removedRoles: [] });
    }

    await member
      .send({
        embeds: [
          buildDmEmbed(
            '✅ С вас снят чёрный список',
            'Модерация сняла вас с чёрного списка. Вы можете снова пользоваться сервером.',
            0x57f287,
          ),
        ],
      })
      .catch(() => null);

    await postDecisionMessage(interaction.client, gc.channels.blacklistLog, 'application', {
      label: 'Снят с ЧС',
      color: 0x57f287,
      reviewerId: interaction.user.id,
      targetUserId: userId,
      reason: { title: 'Причина снятия ЧС', text: reason },
      number: existing?.number,
    });

    const baseReply = `Участник <@${userId}> снят с ЧС.`;
    await interaction.editReply({
      content: warnings.length ? `${baseReply}\n${warnings.join('\n')}` : baseReply,
    });
  },
};

export default handler;
