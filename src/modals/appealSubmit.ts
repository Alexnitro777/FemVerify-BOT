import { ModalSubmitInteraction, TextChannel, MessageFlags } from 'discord.js';
import { ModalHandler, GuildConfig } from '../types';
import { appealQuestions } from '../questions';
import {
  getApplication, getAppealsForUser, reserveAppealSubmission, nextAppealNumber,
  getSpecialBlacklist, setAppealReviewMessage, deletePendingAppealSubmission,
} from '../storage';
import { buildAppealEmbed, buildAppealReviewButtons } from '../ui';
import { isMainGuild } from '../config';
import { appealSubmissionError, isBlacklistType } from '../appealPolicy';
import { runUserExclusive } from '../concurrency';

const handler: ModalHandler = {
  customId: /^appeal:submit:(ЧСП|ЧСЗ|ЧСА)$/,

  async execute(interaction: ModalSubmitInteraction, gc: GuildConfig): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await runUserExclusive(interaction.user.id, async () => {
      const type = interaction.customId.split(':')[2];
      const guildId = interaction.guildId!;
      if (!isMainGuild(guildId) || !isBlacklistType(type)) {
        await interaction.editReply({ content: 'Подать апелляцию можно только на основном сервере проекта.' });
        return;
      }
      const text = interaction.fields.getTextInputValue('text').trim();
      const question = appealQuestions[0];
      if (text.length < (question.minLength ?? 0) || text.length > (question.maxLength ?? 4000)) {
        await interaction.editReply({ content: 'Текст апелляции не соответствует ограничениям формы.' });
        return;
      }
      const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
      const roleId = type === 'ЧСП' ? gc.roles.blacklist : type === 'ЧСЗ' ? gc.roles.blacklistZ : gc.roles.blacklistA;
      if (!member || !roleId || !member.roles.cache.has(roleId) || (type !== 'ЧСП' && member.roles.cache.has(gc.roles.blacklist))) {
        await interaction.editReply({ content: 'Этот тип блокировки больше недоступен для обжалования.' });
        return;
      }
      const error = appealSubmissionError(await getAppealsForUser(guildId, interaction.user.id), type);
      if (error) {
        await interaction.editReply({ content: error });
        return;
      }
      const channel = gc.channels.appealReview
        ? await interaction.client.channels.fetch(gc.channels.appealReview).catch(() => null)
        : null;
      if (!channel?.isTextBased()) {
        await interaction.editReply({ content: '❌ Не удалось отправить апелляцию: канал модерации недоступен. Сообщите администрации.' });
        return;
      }
      const application = type === 'ЧСП' ? await getApplication(guildId, interaction.user.id) : undefined;
      const special = type !== 'ЧСП' ? await getSpecialBlacklist(guildId, interaction.user.id, type) : undefined;
      const blacklistReason = type === 'ЧСП' ? application?.reason : special?.reason;
      const number = await nextAppealNumber(guildId);
      const appealId = await reserveAppealSubmission({
        userId: interaction.user.id,
        guildId,
        username: interaction.user.tag,
        text,
        submittedAt: Date.now(),
        status: 'pending',
        blacklistReason,
        blacklistType: type,
        number,
      });
      if (appealId === false) {
        await interaction.editReply({ content: 'Апелляция не отправлена: проверьте лимит обращений и срок повторной подачи.' });
        return;
      }
      let message;
      try {
        message = await (channel as TextChannel).send({
          content: `<@${interaction.user.id}>`,
          embeds: [buildAppealEmbed(interaction.user, text, blacklistReason, number, `<@&${roleId}>`)],
          components: [buildAppealReviewButtons(interaction.user.id, undefined, type, appealId)],
          allowedMentions: { users: [interaction.user.id] },
        });
      } catch (error) {
        console.error('[appealSubmit] failed to post appeal message', error);
        await deletePendingAppealSubmission(guildId, appealId);
        await interaction.editReply({ content: '❌ Не удалось отправить апелляцию модерации. Попробуйте позже.' });
        return;
      }
      try {
        await setAppealReviewMessage(guildId, appealId, message.url);
      } catch (error) {
        console.error('[appealSubmit] failed to confirm review link', appealId, error);
        await interaction.editReply({ content: 'Апелляция размещена в канале модерации, но не удалось сохранить ссылку. Сообщите администрации.' });
        return;
      }
      await interaction.editReply({ content: '✅ Апелляция отправлена. Ожидайте решения модерации.' });
    });
  },
};

export default handler;
