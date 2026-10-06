import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { SlashCommand, GuildConfig } from '../types';
import { getModeratorStats } from '../storage';
import { buildAdminStatEmbed } from '../ui';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('админстат')
    .setDescription('Показать статистику работы модератора (анкеты, апелляции, вопросы)')
    .addUserOption((opt) =>
      opt
        .setName('пользователь')
        .setDescription('Модератор, чью статистику показать (по умолчанию — вы)')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames) as unknown as SlashCommand['data'],

  access: 'staff',

  async execute(interaction: ChatInputCommandInteraction, gc: GuildConfig): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Команду нужно запускать на сервере.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetUser = interaction.options.getUser('пользователь') ?? interaction.user;
    const targetMember =
      interaction.guild.members.cache.get(targetUser.id) ??
      (await interaction.guild.members.fetch(targetUser.id).catch(() => null));

    const stats = await getModeratorStats(interaction.guildId!, targetUser.id);
    const embed = buildAdminStatEmbed(targetUser, targetMember, gc, stats, interaction.guild.name);

    await interaction.editReply({ embeds: [embed] });
  },
};

export default command;
