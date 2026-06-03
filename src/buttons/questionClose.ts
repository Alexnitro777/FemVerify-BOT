import { ButtonInteraction, PermissionFlagsBits, GuildMember, MessageFlags } from 'discord.js';
import { ButtonHandler } from '../types';
import { config } from '../config';
import { restoreReviewButton } from '../questionRestore';

const handler: ButtonHandler = {
  customId: /^question:close:\d+$/,

  async execute(interaction: ButtonInteraction): Promise<void> {
    const member = interaction.member as GuildMember | null;
    const allowed =
      member &&
      (member.permissions.has(PermissionFlagsBits.ManageChannels) ||
        config.roles.mod.some((roleId) => member.roles.cache.has(roleId)));
    if (!allowed) {
      await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
      return;
    }

    const [, , channelId] = interaction.customId.split(':');
    await interaction.reply({ content: 'Удаляю канал...', flags: MessageFlags.Ephemeral });

    // Возвращаем кнопку «Задать вопрос» на сообщении заявки/апелляции.
    await restoreReviewButton(interaction.client, channelId);

    const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
    await channel?.delete().catch((e) => {
      console.error('[questionClose] failed to delete channel', e);
      return null;
    });
  },
};

export default handler;
