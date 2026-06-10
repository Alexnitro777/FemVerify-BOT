import { ModalSubmitInteraction, MessageFlags } from 'discord.js';
import { ModalHandler } from '../types';
import { config } from '../config';
import { getApplication, updateApplication } from '../storage';
import { buildDmEmbed, postDecisionMessage } from '../ui';
import { restoreMemberRoles } from '../roles';

const handler: ModalHandler = {
  customId: /^unchsp:reason:\d+$/,

  async execute(interaction: ModalSubmitInteraction): Promise<void> {
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

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: 'Пользователь не найден на сервере.' });
      return;
    }

    const warnings: string[] = [];

    const roleRemoved = await member.roles
      .remove(config.roles.blacklist)
      .then(() => true)
      .catch((e) => {
        console.error('[unchspReason] roles.remove failed', e);
        return false;
      });
    if (!roleRemoved) {
      warnings.push('⚠️ Не удалось снять роль ЧС — проверьте иерархию ролей бота.');
    }

    const existing = getApplication(userId);
    const toRestore = existing?.removedRoles ?? [];
    if (toRestore.length > 0) {
      const restored = await restoreMemberRoles(member, toRestore);
      if (!restored) {
        warnings.push('⚠️ Не удалось вернуть часть ролей — проверьте иерархию ролей бота.');
      }
      updateApplication(userId, { removedRoles: [] });
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

    await postDecisionMessage(interaction.client, config.channels.blacklistLog, 'application', {
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
