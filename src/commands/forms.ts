import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { SlashCommand, GuildConfig } from '../types';
import { listPendingApplications } from '../storage';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('анкеты')
    .setDescription('Показать все непринятые анкеты на верификацию')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames) as unknown as SlashCommand['data'],

  access: 'mod',

  async execute(interaction: ChatInputCommandInteraction, _gc: GuildConfig): Promise<void> {
    const pending = await listPendingApplications(interaction.guildId!);

    if (pending.length === 0) {
      await interaction.reply({
        content: 'Непринятых анкет нет. 🎉',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const lines = pending.map((app, i) => {
      const ts = Math.floor(app.submittedAt / 1000);
      const link = app.reviewMessageUrl ? ` — [перейти](${app.reviewMessageUrl})` : '';
      const num = app.number ? `№\`${app.number}\`` : `\`${i + 1}.\``;
      return `**${num}** <@${app.userId}> (${app.username}) — <t:${ts}:R>${link}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(`📝 Непринятые анкеты — ${pending.length}`)
      .setColor(0xfee75c)
      .setDescription(lines.join('\n').slice(0, 4096))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};

export default command;
