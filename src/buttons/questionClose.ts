import { ButtonInteraction, MessageFlags } from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import { hasButtonAccess } from '../permissions';
import { restoreReviewButton } from '../questionRestore';
import { deleteQuestionChannel } from '../channels';

const handler: ButtonHandler = {
  customId: /^question:close:\d+$/,

  async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
    if (!hasButtonAccess(interaction, gc, 'staff')) {
      await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
      return;
    }

    const guild = interaction.guild;
    if (!guild) return;

    const [, , channelId] = interaction.customId.split(':');
    await interaction.reply({ content: 'Удаляю канал...', flags: MessageFlags.Ephemeral });

    const deleted = await deleteQuestionChannel(guild, channelId, {
      reason: 'Канал закрыт вручную',
      closedByUserId: interaction.user.id,
    });

    if (deleted) {
      await restoreReviewButton(interaction.client, channelId);
    } else {
      await interaction
        .editReply({ content: '❌ Не удалось удалить канал — проверьте права бота.' })
        .catch(() => null);
    }
  },
};

export default handler;
