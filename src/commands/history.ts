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
        .setName('цель')
        .setDescription('Чью историю посмотреть (выберите участника или вставьте ID)')
        .setRequired(true),
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

    const user = interaction.options.getUser('цель', true);
    const targetId = user.id;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const history = await getUserHistory(interaction.guildId!, targetId);

    if (history.length === 0) {
      await interaction.editReply({
        content: `Истории действий для пользователя <@${targetId}> (ID: \`${targetId}\`) не найдено.`,
      });
      return;
    }

    const { embed, row } = buildHistoryView(
      targetId,
      user.tag,
      user.displayAvatarURL(),
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
