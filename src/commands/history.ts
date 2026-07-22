import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { SlashCommand, GuildConfig } from '../types';
import { getUserHistory } from '../storage';
import { buildHistoryView } from '../ui';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('история')
    .setDescription('Показать историю заявок, апелляций и ЧС участника')
    .addUserOption((option) =>
      option
        .setName('участник')
        .setDescription('Выберите участника')
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName('id')
        .setDescription('Или введите ID пользователя')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames) as unknown as SlashCommand['data'],

  access: 'staff',

  async execute(interaction: ChatInputCommandInteraction, _gc: GuildConfig): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Команду нужно запускать на сервере.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = interaction.options.getUser('участник');
    const targetIdInput = interaction.options.getString('id')?.trim();

    let targetId = targetUser?.id;
    if (!targetId && targetIdInput) {
      targetId = targetIdInput.replace(/[<@!>]/g, '');
    }

    if (!targetId) {
      await interaction.reply({
        content: 'Укажите участника или его ID (например: `/история участник:@User` или `/история id:123456789`).',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const user = targetUser ?? (await interaction.client.users.fetch(targetId).catch(() => null));
    const history = await getUserHistory(interaction.guildId!, targetId);

    if (history.length === 0) {
      await interaction.editReply({
        content: `Истории действий для пользователя <@${targetId}> (ID: \`${targetId}\`) не найдено.`,
      });
      return;
    }

    const { embed, row } = buildHistoryView(
      targetId,
      user?.tag,
      user?.displayAvatarURL(),
      history,
      0,
    );

    await interaction.editReply({
      embeds: [embed],
      components: row ? [row] : [],
    });
  },
};

export default command;
