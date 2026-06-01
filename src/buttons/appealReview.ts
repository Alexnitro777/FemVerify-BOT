import {
  ButtonInteraction,
  EmbedBuilder,
  MessageFlags,
} from 'discord.js';
import { ButtonHandler } from '../types';
import { config } from '../config';
import { getAppeal, claimAppeal } from '../storage';
import { buildResolvedEmbed, buildDmEmbed, postDecisionMessage } from '../ui';
import { isMod, getGuild } from '../permissions';

// appeal:<amnesty|deny>:<userId>
const handler: ButtonHandler = {
  customId: /^appeal:(amnesty|deny):\d+$/,

  async execute(interaction: ButtonInteraction): Promise<void> {
    if (!isMod(interaction)) {
      await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
      return;
    }

    const [, action, userId] = interaction.customId.split(':');

    // Редактируем исходное сообщение -> deferUpdate перед сетевыми вызовами (баг #1).
    await interaction.deferUpdate();

    const appeal = getAppeal(userId);
    if (!appeal) {
      await interaction.followUp({ content: 'Аппеляция не найдена.', flags: MessageFlags.Ephemeral });
      return;
    }

    const newStatus = action === 'amnesty' ? 'amnestied' : 'denied';
    // Атомарно переводим из pending — защита от двойной обработки.
    const claimed = claimAppeal(userId, newStatus, interaction.user.id);
    if (!claimed) {
      const fresh = getAppeal(userId);
      await interaction.followUp({
        content: `Аппеляция уже обработана (${fresh?.status ?? 'не найдена'}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = getGuild(interaction);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;

    let warning: string | undefined;
    if (action === 'amnesty') {
      // Снимаем только роль ЧС. Проверяем успех — при ошибке предупреждаем модератора.
      const removed = await member?.roles
        .remove(config.roles.blacklist)
        .then(() => true)
        .catch((e) => {
          console.error('[appealReview] roles.remove failed', e);
          return false;
        });
      if (member && !removed) {
        warning = '⚠️ Не удалось снять роль ЧС — проверьте иерархию ролей бота.';
      }
      await member
        ?.send({
          embeds: [
            buildDmEmbed(
              '✅ Амнистия принята',
              'С вас снят чёрный список. Вы можете снова пройти верификацию.',
              0x57f287,
            ),
          ],
        })
        .catch(() => null);
    } else {
      await member
        ?.send({
          embeds: [
            buildDmEmbed('❌ В амнистии отказано', 'Ваша аппеляция отклонена. ЧС сохраняется.', 0xed4245),
          ],
        })
        .catch(() => null);
    }

    const resolved = buildResolvedEmbed(
      EmbedBuilder.from(interaction.message.embeds[0]),
      action === 'amnesty' ? 'Амнистия принята' : 'В амнистии отказано',
      action === 'amnesty' ? 0x57f287 : 0xed4245,
      interaction.user.id,
    );
    await interaction.editReply({ embeds: [resolved], components: [] });

    // Отдельное сообщение-решение в канал решений (со ссылкой на апелляцию).
    await postDecisionMessage(interaction.client, config.channels.decisions, 'appeal', {
      label: action === 'amnesty' ? 'Амнистия принята' : 'В амнистии отказано',
      color: action === 'amnesty' ? 0x57f287 : 0xed4245,
      reviewerId: interaction.user.id,
      targetUserId: userId,
      reviewMessageUrl: appeal.reviewMessageUrl ?? interaction.message.url,
    });

    if (warning) {
      await interaction.followUp({ content: warning, flags: MessageFlags.Ephemeral });
    }
  },
};

export default handler;
