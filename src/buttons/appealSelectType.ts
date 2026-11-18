import { ButtonInteraction, GuildMember, MessageFlags } from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import { isMainGuild } from '../config';
import { getAppealsForUser } from '../storage';
import { appealSubmissionError, isBlacklistType } from '../appealPolicy';
import { buildAppealModal } from '../ui';

const handler: ButtonHandler = {
  customId: /^appeal:select_type:(ЧСП|ЧСЗ|ЧСА)$/,

  async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
    const type = interaction.customId.split(':')[2];
    if (!isMainGuild(interaction.guildId) || !isBlacklistType(type)) {
      await interaction.reply({ content: 'Подать апелляцию можно только на основном сервере проекта.', flags: MessageFlags.Ephemeral });
      return;
    }
    const member = interaction.member as GuildMember | null;
    const role = type === 'ЧСП' ? gc.roles.blacklist : type === 'ЧСЗ' ? gc.roles.blacklistZ : gc.roles.blacklistA;
    if (!role || !member?.roles.cache.has(role) || (type !== 'ЧСП' && member.roles.cache.has(gc.roles.blacklist))) {
      await interaction.reply({ content: 'Этот тип блокировки больше недоступен для обжалования.', flags: MessageFlags.Ephemeral });
      return;
    }
    const error = appealSubmissionError(await getAppealsForUser(interaction.guildId!, interaction.user.id), type);
    if (error) {
      await interaction.reply({ content: error, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.showModal(buildAppealModal(type));
  },
};

export default handler;
