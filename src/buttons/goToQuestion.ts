import { ButtonInteraction, MessageFlags } from 'discord.js';
import { ButtonHandler } from '../types';

const handler: ButtonHandler = {
  customId: /^goto:question:\d+$/,

  async execute(interaction: ButtonInteraction): Promise<void> {
    const [, , channelId] = interaction.customId.split(':');

    const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      await interaction.reply({
        content: 'Канал с вопросом уже закрыт.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `Канал с вопросом: <#${channelId}>`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default handler;
