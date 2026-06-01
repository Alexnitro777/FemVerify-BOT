import {
  ButtonInteraction,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} from 'discord.js';
import { ButtonHandler } from '../types';
import { config } from '../config';
import { getApplication, claimApplication, updateApplication } from '../storage';
import { buildResolvedEmbed, buildDmEmbed, buildWelcomeEmbed, postDecisionMessage, buildProcessedButtonRow } from '../ui';
import { isMod, getGuild } from '../permissions';

// review:<action>:<userId>
const handler: ButtonHandler = {
  customId: /^review:(approve|reject|question|blacklist):\d+$/,

  async execute(interaction: ButtonInteraction): Promise<void> {
    if (!isMod(interaction)) {
      await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
      return;
    }

    const guild = getGuild(interaction);
    if (!guild) {
      await interaction.reply({ content: 'Действие доступно только на сервере.', flags: MessageFlags.Ephemeral });
      return;
    }

    const [, action, userId] = interaction.customId.split(':');
    const app = getApplication(userId);
    if (!app) {
      await interaction.reply({ content: 'Заявка не найдена.', flags: MessageFlags.Ephemeral });
      return;
    }

    // reject / blacklist требуют причину -> открываем модалку
    if (action === 'reject' || action === 'blacklist') {
      if (app.status !== 'pending') {
        await interaction.reply({ content: `Заявка уже обработана (${app.status}).`, flags: MessageFlags.Ephemeral });
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId(`review:reason:${action}:${userId}`)
        .setTitle(action === 'reject' ? 'Причина отказа' : 'Причина ЧС');
      const input = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Укажите причину')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    // question -> создаём приватный канал, не меняя статус заявки
    if (action === 'question') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      // Защита от дублей: если канал уже создан и ещё существует — вернём
      // ссылку на него вместо создания нового (баг #5).
      if (app.questionChannelId) {
        const existing = await guild.channels.fetch(app.questionChannelId).catch(() => null);
        if (existing) {
          await interaction.editReply({ content: `Канал с вопросом уже существует: <#${existing.id}>` });
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

      updateApplication(userId, { questionChannelId: channel.id });

      const embed = new EmbedBuilder()
        .setTitle('Уточнение по заявке')
        .setDescription(
          `<@${userId}>, у модерации появился вопрос по вашей анкете.\n` +
            'Ответьте здесь. Кнопки ниже — для модерации.',
        )
        .setColor(0x5865f2);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Открыть анкету')
          .setStyle(ButtonStyle.Link)
          .setURL(app.reviewMessageUrl ?? interaction.message.url),
        new ButtonBuilder()
          .setCustomId(`question:close:${channel.id}`)
          .setLabel('Закрыть канал')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🗑️'),
      );

      const pingMsg = await channel.send({
        content: `<@${userId}> <@${interaction.user.id}>`,
        allowedMentions: { users: [userId, interaction.user.id] },
      });
      await channel.send({ embeds: [embed], components: [row] });
      await pingMsg.delete().catch(() => null);
      await interaction.editReply({ content: `Канал создан: <#${channel.id}>` });
      return;
    }

    // approve — редактируем исходное сообщение, поэтому deferUpdate (баг #1).
    await interaction.deferUpdate();

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await interaction.followUp({ content: 'Пользователь покинул сервер.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Атомарно «столбим» заявку, чтобы при двойном клике двух модераторов
    // роль и ЛС выдались ровно один раз (баг #2).
    const claimed = claimApplication(userId, 'approved', interaction.user.id);
    if (!claimed) {
      const fresh = getApplication(userId);
      await interaction.followUp({
        content: `Заявка уже обработана (${fresh?.status ?? 'не найдена'}).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Проверяем успех выдачи роли — если упало (иерархия ролей), откатываем
    // статус обратно в pending, чтобы заявка не висела «одобренной» без роли (баг #3).
    try {
      await member.roles.add(config.roles.verified);
    } catch (e) {
      console.error('[review] roles.add failed', e);
      updateApplication(userId, { status: 'pending', reviewerId: undefined });
      await interaction.followUp({
        content: '❌ Не удалось выдать роль — проверьте, что роль бота выше выдаваемой. Статус заявки возвращён в ожидание.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const dmOk = await member
      .send({
        embeds: [buildDmEmbed('✅ Заявка одобрена', 'Добро пожаловать на сервер!', 0x57f287)],
      })
      .then(() => true)
      .catch(() => false);

    const resolved = buildResolvedEmbed(
      EmbedBuilder.from(interaction.message.embeds[0]),
      'Принято',
      0x57f287,
      interaction.user.id,
    );
    await interaction.editReply({
      embeds: [resolved],
      components: [buildProcessedButtonRow('application')],
    });

    // Отдельное сообщение-решение в канал решений (со ссылкой на анкету).
    await postDecisionMessage(interaction.client, config.channels.decisions, 'application', {
      label: 'Принято',
      color: 0x57f287,
      reviewerId: interaction.user.id,
      targetUserId: userId,
      reviewMessageUrl: app.reviewMessageUrl ?? interaction.message.url,
    });

    // Приветственный embed в общий канал (если настроен WELCOME_CHANNEL_ID).
    if (config.channels.welcome) {
      try {
        const welcomeChannel = await guild.channels.fetch(config.channels.welcome);
        if (welcomeChannel?.isTextBased()) {
          // Сначала отправляем пинг отдельным сообщением
          const pingMessage = await welcomeChannel.send({
            content: `<@${userId}>`,
            allowedMentions: { users: [userId] },
          });
          // Удаляем пинг
          await pingMessage.delete();
          // Отправляем embed без пинга
          await welcomeChannel.send({
            embeds: [buildWelcomeEmbed(member)],
          });
        }
      } catch (e) {
        console.error('[review] welcome message failed', e);
      }
    }

    if (!dmOk) {
      await interaction.followUp({
        content: '⚠️ Роль выдана, но отправить ЛС не удалось (закрыты личные сообщения).',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

export default handler;
