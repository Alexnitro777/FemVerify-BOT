import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { SlashCommand } from '../types';
import { listPendingAppeals } from '../storage';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('амнистии')
    .setDescription('Показать все непринятые апелляции')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames) as unknown as SlashCommand['data'],

  access: 'mod',

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const pending = listPendingAppeals();

    if (pending.length === 0) {
      await interaction.reply({
        content: 'Непринятых апелляций нет. 🎉',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = pending.map((appeal, i) => {
      const ts = Math.floor(appeal.submittedAt / 1000);
      const link = appeal.reviewMessageUrl ? ` — [перейти](${appeal.reviewMessageUrl})` : '';
      const num = appeal.number ? `№${appeal.number}` : `${i + 1}.`;
      return `**${num}** <@${appeal.userId}> (${appeal.username}) — <t:${ts}:R>${link}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`⚖️ Непринятые апелляции — ${pending.length}`)
      .setColor(0xeb459e)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;
