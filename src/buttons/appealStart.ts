import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, GuildMember, MessageFlags } from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import { getAppealsForUser } from '../storage';
import { isMainGuild, getMainGuildInvite } from '../config';
import { buildAppealModal } from '../ui';
import { appealSubmissionError, BlacklistType } from '../appealPolicy';

const handler: ButtonHandler = {
  customId: 'appeal:start',

  async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
    if (!isMainGuild(interaction.guildId)) {
      const invite = getMainGuildInvite();
      await interaction.reply({
        content: invite
          ? `Подать апелляцию можно только на основном сервере проекта: ${invite}`
          : 'Подать апелляцию можно только на основном сервере проекта.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const member = interaction.member as GuildMember | null;
    const available: BlacklistType[] = [];
    if (member?.roles.cache.has(gc.roles.blacklist)) available.push('ЧСП');
    else {
      if (gc.roles.blacklistZ && member?.roles.cache.has(gc.roles.blacklistZ)) available.push('ЧСЗ');
      if (gc.roles.blacklistA && member?.roles.cache.has(gc.roles.blacklistA)) available.push('ЧСА');
    }
    if (!available.length) {
      await interaction.reply({ content: 'Апелляция доступна только участникам в чёрном списке.', flags: MessageFlags.Ephemeral });
      return;
    }
    const appeals = await getAppealsForUser(interaction.guildId!, interaction.user.id);
    const valid = available.filter((type) => !appealSubmissionError(appeals, type));
    if (!valid.length) {
      await interaction.reply({ content: appealSubmissionError(appeals, available[0])!, flags: MessageFlags.Ephemeral });
      return;
    }
    if (valid.length === 1) {
      await interaction.showModal(buildAppealModal(valid[0]));
      return;
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      ...valid.map((type) => new ButtonBuilder()
        .setCustomId(`appeal:select_type:${type}`)
        .setLabel(type)
        .setStyle(type === 'ЧСЗ' ? ButtonStyle.Primary : ButtonStyle.Danger)),
    );
    await interaction.reply({
      content: 'Пожалуйста, выберите тип блокировки, которую вы хотите обжаловать:',
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },
};

export default handler;
