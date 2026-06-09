import { ModalSubmitInteraction, MessageFlags } from 'discord.js';
import { ModalHandler } from '../types';
import { config } from '../config';
import { getApplication, updateApplication, saveApplication } from '../storage';
import { buildDmEmbed, postDecisionMessage } from '../ui';
import { blacklistMemberRoles } from '../roles';

const handler: ModalHandler = {
  customId: /^chsp:reason:\d+$/,

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
        content: 'Укажите причину занесения в ЧС.',
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

    const { ok: rolesOk, removed } = await blacklistMemberRoles(member);

    const existing = getApplication(userId);
    if (existing) {
      updateApplication(userId, {
        status: 'blacklisted',
        reason,
        reviewerId: interaction.user.id,
        removedRoles: removed,
      });
    } else {
      saveApplication({
        userId,
        username: member.user.tag,
        guildId: interaction.guild.id,
        answers: {},
        submittedAt: Date.now(),
        status: 'blacklisted',
        reason,
        reviewerId: interaction.user.id,
        removedRoles: removed,
      });
    }

    await member
      .send({
        embeds: [
          buildDmEmbed(
            '🚫 Вы добавлены в чёрный список',
            `Причина: \`${reason}\`\n\nВы можете подать апелляцию в ${
              config.channels.appeal ? `<#${config.channels.appeal}>` : 'соответствующем канале'
            }.`,
            0x992d22,
          ),
        ],
      })
      .catch(() => null);

    await postDecisionMessage(interaction.client, config.channels.decisions, 'application', {
      label: 'ЧС',
      color: 0x992d22,
      reviewerId: interaction.user.id,
      targetUserId: userId,
      reason: { title: 'Причина ЧС', text: reason },
      number: existing?.number,
    });

    const baseReply = `Участник <@${userId}> добавлен в ЧС.`;
    await interaction.editReply({
      content: rolesOk
        ? baseReply
        : `${baseReply}\n⚠️ Не удалось снять все роли — проверьте иерархию ролей бота.`,
    });
  },
};

export default handler;
