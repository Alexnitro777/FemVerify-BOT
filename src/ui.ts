import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  User,
  GuildMember,
} from 'discord.js';
import { Application } from './types';
import { verifyQuestions } from './questions';

/** Embed с ответами анкеты для канала модерации. */
export function buildApplicationEmbed(user: User, answers: Record<string, string>): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle('Новая заявка на верификацию')
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setThumbnail(user.displayAvatarURL())
    .setColor(0xfee75c)
    .setFooter({ text: `ID: ${user.id}` })
    .setTimestamp();

  for (const q of verifyQuestions.slice(0, 5)) {
    const value = (answers[q.id] ?? '').trim() || '—';
    embed.addFields({
      name: q.label,
      value: value.length > 1024 ? value.slice(0, 1021) + '...' : value,
    });
  }
  return embed;
}

/** Четыре кнопки модерации под заявкой. */
export function buildReviewButtons(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`review:approve:${userId}`)
      .setLabel('Принять')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`review:reject:${userId}`)
      .setLabel('Отклонить')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌'),
    new ButtonBuilder()
      .setCustomId(`review:question:${userId}`)
      .setLabel('Задать вопрос')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('❓'),
    new ButtonBuilder()
      .setCustomId(`review:blacklist:${userId}`)
      .setLabel('ЧС')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🚫'),
  );
}

/** Помечает embed заявки итоговым статусом и убирает кнопки. Работает с копией, не мутируя исходный. */
export function buildResolvedEmbed(
  original: EmbedBuilder,
  label: string,
  color: number,
  reviewerId: string,
  reason?: string,
): EmbedBuilder {
  return EmbedBuilder.from(original.data)
    .setColor(color)
    .addFields({
      name: label,
      value: reason ? `<@${reviewerId}>\nПричина: ${reason}` : `<@${reviewerId}>`,
    });
}

/** ЛС-уведомление участнику. */
export function buildDmEmbed(title: string, description: string, color: number): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

/**
 * Приветственный embed в общий канал после принятия верификации.
 * Формат по reference: автор — принятый участник, ник-пинг в описании,
 * поля «Участник №» и «Аккаунт создан», футер с названием/иконкой сервера.
 */
export function buildWelcomeEmbed(member: GuildMember): EmbedBuilder {
  const { guild, user } = member;
  const createdTs = Math.floor(user.createdTimestamp / 1000);

  return new EmbedBuilder()
    .setAuthor({ name: user.tag, iconURL: user.displayAvatarURL() })
    .setTitle('🎉  Добро пожаловать!')
    .setDescription(`Добро пожаловать на **${guild.name}**!`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: '👥  Участник №', value: `${guild.memberCount}`, inline: true },
      { name: '🗓  Аккаунт создан', value: `<t:${createdTs}:R>`, inline: true },
    )
    .setColor(0x57f287)
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp();
}

export type ReviewAction = 'approve' | 'reject' | 'question' | 'blacklist';
