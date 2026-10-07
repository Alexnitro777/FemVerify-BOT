import { ButtonInteraction, MessageFlags } from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import { getTrapKicksCount } from '../storage';

const handler: ButtonHandler = {
  customId: 'trap:kicks',

  async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
    const count = await getTrapKicksCount(gc.guildId);
    await interaction.reply({
      content: `🛡️ Через ловушку выдано ЧСП: **${count}**`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default handler;
