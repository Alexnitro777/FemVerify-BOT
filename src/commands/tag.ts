import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { SlashCommand } from '../types';
import { hasServerTag, getPrimaryGuild } from '../serverTag';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('tag')
    .setDescription('Статистика по тегу сервера: сколько участников его носят') as unknown as SlashCommand['data'],

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Команду нужно запускать на сервере.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Подсчёт может занять время (подгрузка всех участников) — откладываем ответ.
    await interaction.deferReply();

    const guild = interaction.guild;
    const members = await guild.members.fetch();

    let withTag = 0;
    let humans = 0;
    let tagText: string | null = null;

    for (const member of members.values()) {
      if (member.user.bot) continue;
      humans += 1;
      if (hasServerTag(member.user)) {
        withTag += 1;
        if (!tagText) {
          tagText = getPrimaryGuild(member.user)?.tag ?? null;
        }
      }
    }

    const percent = humans > 0 ? ((withTag / humans) * 100).toFixed(1) : '0.0';

    const embed = new EmbedBuilder()
      .setTitle('🏷️ Тег сервера')
      .setColor(0x9b59b6)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .setDescription(
        tagText
          ? `Текущий тег сервера: \`${tagText}\``
          : 'Показывает, сколько участников носят тег этого сервера.',
      )
      .addFields(
        { name: '🏷️ Носят тег сервера', value: `**${withTag}**`, inline: true },
        { name: '👥 Всего участников', value: `**${humans}**`, inline: true },
        { name: '📊 Доля', value: `**${percent}%**`, inline: true },
      )
      .setFooter({ text: 'Боты в подсчёте не учитываются' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
