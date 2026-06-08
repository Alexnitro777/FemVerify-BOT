import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { SlashCommand } from '../types';
import { config } from '../config';
import { getApplication, updateApplication, saveApplication } from '../storage';
import { buildDmEmbed, postDecisionMessage } from '../ui';
import { blacklistMemberRoles } from '../roles';

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('чсп')
    .setDescription('Занести участника в чёрный список: снять все роли и выдать роль ЧС')
    .addUserOption((option) =>
      option.setName('участник').setDescription('Кого занести в ЧС').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('причина')
        .setDescription('Причина занесения в ЧС')
        .setRequired(true)
        .setMaxLength(1000),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames) as unknown as SlashCommand['data'],

  access: 'mod',

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Команду нужно запускать на сервере.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = interaction.options.getUser('участник', true);
    const reason = interaction.options.getString('причина', true).trim();

    if (!reason) {
      await interaction.reply({
        content: 'Укажите причину занесения в ЧС.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.editReply({ content: 'Пользователь не найден на сервере.' });
      return;
    }

    const rolesOk = await blacklistMemberRoles(member);

    const existing = getApplication(user.id);
    if (existing) {
      updateApplication(user.id, {
        status: 'blacklisted',
        reason,
        reviewerId: interaction.user.id,
      });
    } else {
      saveApplication({
        userId: user.id,
        username: user.tag,
        guildId: interaction.guild.id,
        answers: {},
        submittedAt: Date.now(),
        status: 'blacklisted',
        reason,
        reviewerId: interaction.user.id,
      });
    }

    await member
      .send({
        embeds: [
          buildDmEmbed(
            '🚫 Вы добавлены в чёрный список',
            `Причина: \`${reason}\`\n\nВы можете подать апелляцию в ${
              config.channels.appeal ? `<#${config.channels.appeal}>` : 'соответствующем канале'
            }.`,
            0x992d22,
          ),
        ],
      })
      .catch(() => null);

    await postDecisionMessage(interaction.client, config.channels.decisions, 'application', {
      label: 'ЧС',
      color: 0x992d22,
      reviewerId: interaction.user.id,
      targetUserId: user.id,
      reason: { title: 'Причина ЧС', text: reason },
      number: existing?.number,
    });

    const baseReply = `Участник <@${user.id}> добавлен в ЧС.`;
    await interaction.editReply({
      content: rolesOk
        ? baseReply
        : `${baseReply}\n⚠️ Не удалось снять все роли — проверьте иерархию ролей бота.`,
    });
  },
};

export default command;
