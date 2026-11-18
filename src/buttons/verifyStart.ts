import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import { verifyQuestions } from '../questions';
import { getApplication, getUserGlobalStatus } from '../storage';
import { postDecisionMessage } from '../ui';
import { isMainGuild, getMainGuildInvite } from '../config';
import { runUserExclusive } from '../concurrency';

const handler: ButtonHandler = {
  customId: 'verify:start',

  async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
    const member = interaction.member as GuildMember | null;
    const status = await getUserGlobalStatus(interaction.user.id);
    if (status.blacklisted || member?.roles.cache.has(gc.roles.blacklist)) {
      const isMain = isMainGuild(interaction.guildId);
      const invite = getMainGuildInvite();
      const content = !isMain && invite
        ? `Вы находитесь в чёрном списке. Подать апелляцию можно на основном сервере проекта: ${invite}`
        : !isMain
        ? 'Вы находитесь в чёрном списке. Подать апелляцию можно на основном сервере проекта.'
        : 'Вы находитесь в чёрном списке. Используйте канал апелляции.';
      await interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = await getApplication(interaction.guildId!, interaction.user.id);
    if (existing?.status === 'pending') {
      await interaction.reply({ content: 'Ваша заявка уже на рассмотрении.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (existing?.removedRoles?.length && existing.status !== 'blacklisted') {
      await interaction.reply({ content: 'Возврат ролей после амнистии ещё не завершён. Попросите администрацию повторить снятие ЧСП.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (member?.roles.cache.has(gc.roles.verified)) {
      await interaction.reply({ content: 'Вы уже верифицированы.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (status.verified && member) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await runUserExclusive(interaction.user.id, async () => {
        const fresh = await getUserGlobalStatus(interaction.user.id);
        if (fresh.blacklisted) {
          await interaction.editReply({ content: 'Вы находитесь в чёрном списке. Используйте канал апелляции.' });
          return;
        }
        try {
          await member.roles.add(gc.roles.verified);
        } catch (error) {
          console.error('[verifyStart] roles.add failed', error);
          await interaction.editReply({ content: '❌ Не удалось выдать роль верификации. Сообщите администрации.' });
          return;
        }
        await postDecisionMessage(interaction.client, gc.channels.decisions, 'application', {
          label: 'Авто-Верификация',
          color: 0x57f287,
          reviewerId: interaction.client.user!.id,
          targetUserId: interaction.user.id,
          reason: { title: 'Причина', text: 'Уже верифицирован на другом сервере проекта' },
          title: 'Автоматическая верификация',
        });
        await interaction.editReply({ content: 'Вы были автоматически верифицированы, так как уже прошли проверку на другом сервере проекта.' });
      });
      return;
    }

    const modal = new ModalBuilder().setCustomId('verify:submit').setTitle('Анкета верификации');

    const rows = verifyQuestions.slice(0, 5).map((q) => {
      const input = new TextInputBuilder()
        .setCustomId(q.id)
        .setLabel(q.label)
        .setStyle(q.style)
        .setRequired(q.required);
      if (q.minLength) input.setMinLength(q.minLength);
      if (q.maxLength) input.setMaxLength(q.maxLength);
      if (q.placeholder) input.setPlaceholder(q.placeholder);
      return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    });

    modal.addComponents(...rows);
    await interaction.showModal(modal);
  },
};

export default handler;
