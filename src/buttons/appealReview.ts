import {
  ButtonInteraction,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { ButtonHandler } from '../types';
import { config } from '../config';
import { getAppeal, claimAppeal, updateAppeal } from '../storage';
import { buildResolvedEmbed, buildDmEmbed, postDecisionMessage, buildProcessedButtonRow } from '../ui';
import { isMod, getGuild } from '../permissions';

const handler: ButtonHandler = {
  customId: /^appeal:(amnesty|deny|question):\d+$/,

  async execute(interaction: ButtonInteraction): Promise<void> {
    if (!isMod(interaction)) {
      await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
      return;
    }

    const [, action, userId] = interaction.customId.split(':');

    if (action === 'question') {
      const guild = getGuild(interaction);
      if (!guild) {
        await interaction.reply({
          content: 'Действие доступно только на сервере.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const appeal = getAppeal(userId);
      if (!appeal) {
        await interaction.editReply({ content: 'Апелляция не найдена.' });
        return;
      }

      if (appeal.questionChannelId) {
        const existing = await guild.channels.fetch(appeal.questionChannelId).catch(() => null);
        if (existing) {
          await interaction.editReply({
            content: `Канал с вопросом уже существует: <#${existing.id}>`,
          });
          return;
        }
      }

      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await interaction.editReply({ content: 'Пользователь покинул сервер.' });
        return;
      }

      const channel = await guild.channels.create({
        name: `вопрос-${member.user.username}`.slice(0, 90),
        type: ChannelType.GuildText,
        parent: config.questionCategoryId,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: userId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          ...config.roles.mod.map((roleId) => ({
            id: roleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          })),
        ],
      });

      updateAppeal(userId, { questionChannelId: channel.id });

      const embed = new EmbedBuilder()
        .setTitle('Уточнение по апелляции')
        .setDescription(
          `<@${userId}>, у модерации появился вопрос по вашей апелляции.\n` +
            'Ответьте здесь. Кнопки ниже — для модерации.',
        )
        .setColor(0x5865f2);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Перейти к апелляции')
          .setStyle(ButtonStyle.Link)
          .setURL(appeal.reviewMessageUrl ?? interaction.message.url),
        new ButtonBuilder()
          .setCustomId(`question:close:${channel.id}`)
          .setLabel('Закрыть вопрос')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🗑️'),
      );

      const mentionUserIds = [...new Set([userId, interaction.user.id])];
      const pingMsg = await channel.send({
        content: mentionUserIds.map((id) => `<@${id}>`).join(' '),
        allowedMentions: { users: mentionUserIds },
      });
      await channel.send({ embeds: [embed], components: [row] });
      await pingMsg.delete().catch(() => null);
      await interaction.editReply({ content: `Канал создан: <#${channel.id}>` });
      return;
    }

    await interaction.deferUpdate();

    const appeal = getAppeal(userId);
    if (!appeal) {
      await interaction.followUp({ content: 'Апелляция не найдена.', flags: MessageFlags.Ephemeral });
      return;
    }

    const newStatus = action === 'amnesty' ? 'amnestied' : 'denied';
    const claimed = claimAppeal(userId, newStatus, interaction.user.id);
    if (!claimed) {
      const fresh = getAppeal(userId);
      await interaction.followUp({
        content: `Апелляция уже обработана (${fresh?.status ?? 'не найдена'}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const guild = getGuild(interaction);
    const member = guild ? await guild.members.fetch(userId).catch(() => null) : null;

    let warning: string | undefined;
    if (action === 'amnesty') {
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
            buildDmEmbed('❌ В амнистии отказано', 'Ваша апелляция отклонена. ЧС сохраняется.', 0xed4245),
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
    await interaction.editReply({
      embeds: [resolved],
      components: [buildProcessedButtonRow('appeal')],
    });

    await postDecisionMessage(interaction.client, config.channels.decisions, 'appeal', {
      label: action === 'amnesty' ? 'Амнистия принята' : 'В амнистии отказано',
      color: action === 'amnesty' ? 0x57f287 : 0xed4245,
      reviewerId: interaction.user.id,
      targetUserId: userId,
      reviewMessageUrl: appeal.reviewMessageUrl ?? interaction.message.url,
    });

    if (appeal.questionChannelId && guild) {
      const questionChannel = await guild.channels.fetch(appeal.questionChannelId).catch(() => null);
      await questionChannel?.delete().catch((e) => {
        console.error('[appealReview] failed to delete question channel', e);
        return null;
      });
      updateAppeal(userId, { questionChannelId: undefined });
    }

    if (warning) {
      await interaction.followUp({ content: warning, flags: MessageFlags.Ephemeral });
    }
  },
};

export default handler;
