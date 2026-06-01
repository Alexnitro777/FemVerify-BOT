import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  User,
  GuildMember,
  Client,
  TextChannel,
} from 'discord.js';
import { Application } from './types';
import { verifyQuestions } from './questions';

/** Embed с ответами анкеты для канала модерации. */
export function buildApplicationEmbed(user: User, answers: Record<string, string>): EmbedBuilder {
  const createdTs = Math.floor(user.createdTimestamp / 1000);

  const embed = new EmbedBuilder()
    .setAuthor({ name: 'Заявка на верификацию' })
    .setThumbnail(user.displayAvatarURL())
    .setColor(0xfee75c)
    .setFooter({ text: `ID: ${user.id}` })
    .setTimestamp();

  // Добавляем информацию об участнике в начале
  embed.addFields(
    { name: 'Участник', value: `<@${user.id}>`, inline: false },
    { name: 'Дата создания аккаунта', value: `<t:${createdTs}:R>`, inline: false },
  );

  for (const q of verifyQuestions.slice(0, 5)) {
    const rawValue = (answers[q.id] ?? '').trim() || '—';
    const value = rawValue === '—' ? rawValue : `\`${rawValue}\``;
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
): EmbedBuilder {
  return EmbedBuilder.from(original.data)
    .setColor(color)
    .addFields({
      name: label,
      value: `<@${reviewerId}>`,
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
    .setTitle('🎉  Добро пожаловать!')
    .setDescription(`<@${user.id}>, добро пожаловать на **${guild.name}**!`)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: '👥  Участник №', value: `\`${guild.memberCount}\``, inline: true },
      { name: '🗓  Аккаунт создан', value: `<t:${createdTs}:R>`, inline: true },
    )
    .setColor(0x57f287)
    .setFooter({ text: guild.name, iconURL: guild.iconURL() ?? undefined })
    .setTimestamp();
}

export type ReviewAction = 'approve' | 'reject' | 'question' | 'blacklist';

// Тип объекта, по которому принято решение.
export type DecisionKind = 'application' | 'appeal';

/**
 * Кнопки под сообщением-решением:
 *  1) ссылка-кнопка, которая перекидывает на оригинал заявки/апелляции;
 *  2) неактивная серая кнопка-метка «Анкета/Апелляция обработана».
 */
export function buildDecisionButtons(
  kind: DecisionKind,
  reviewMessageUrl?: string,
): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (reviewMessageUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel(kind === 'appeal' ? 'Открыть апелляцию' : 'Открыть анкету')
        .setStyle(ButtonStyle.Link)
        .setURL(reviewMessageUrl),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`decision:processed:${kind}`)
      .setLabel(kind === 'appeal' ? 'Апелляция обработана' : 'Анкета обработана')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
  return row;
}

/** Embed с решением админов для отдельного канала решений. Причина не указывается. */
export function buildDecisionEmbed(
  kind: DecisionKind,
  label: string,
  color: number,
  reviewerId: string,
  targetUserId: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setAuthor({ name: kind === 'appeal' ? 'Решение по апелляции' : 'Решение по заявке' })
    .setColor(color)
    .addFields(
      { name: 'Участник', value: `<@${targetUserId}>`, inline: true },
      { name: 'Решение', value: label, inline: true },
      { name: 'Модератор', value: `<@${reviewerId}>`, inline: false },
    )
    .setFooter({ text: `ID: ${targetUserId}` })
    .setTimestamp();
}

/**
 * Отправляет сообщение-решение в канал решений (если он настроен в конфиге).
 * Кидает embed с решением админов, кнопку-ссылку на оригинал и серую метку «обработана».
 */
export async function postDecisionMessage(
  client: Client,
  channelId: string | undefined,
  kind: DecisionKind,
  opts: {
    label: string;
    color: number;
    reviewerId: string;
    targetUserId: string;
    reviewMessageUrl?: string;
  },
): Promise<void> {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error('[decision] decisions channel unavailable:', channelId);
      return;
    }
    const embed = buildDecisionEmbed(kind, opts.label, opts.color, opts.reviewerId, opts.targetUserId);
    const row = buildDecisionButtons(kind, opts.reviewMessageUrl);
    await (channel as TextChannel).send({ embeds: [embed], components: [row] });
  } catch (e) {
    console.error('[decision] failed to post decision message', e);
  }
}
