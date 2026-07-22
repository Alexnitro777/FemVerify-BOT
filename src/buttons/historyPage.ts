import { ButtonInteraction, MessageFlags } from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import { hasButtonAccess } from '../permissions';
import { getUserHistory } from '../storage';
import { buildHistoryView } from '../ui';

const handler: ButtonHandler = {
  customId: /^history:page:\d+:\d+$/,

  async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
    if (!hasButtonAccess(interaction, gc, 'staff')) {
      await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
      return;
    }

    const [, , userId, pageRaw] = interaction.customId.split(':');
    const history = await getUserHistory(interaction.guildId!, userId);

    if (history.length === 0) {
      await interaction.update({ content: 'История действий пуста.', embeds: [], components: [] });
      return;
    }

    const user = await interaction.client.users.fetch(userId).catch(() => null);

    const { embed, row } = buildHistoryView(
      userId,
      user?.tag,
      user?.displayAvatarURL(),
      history,
      Number(pageRaw),
    );

    await interaction.update({ embeds: [embed], components: row ? [row] : [] });
  },
};

export default handler;
