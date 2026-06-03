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

export function buildApplicationEmbed(
  user: User,
  answers: Record<string, string>,
  number?: number,
): EmbedBuilder {
  const createdTs = Math.floor(user.createdTimestamp / 1000);

  const embed = new EmbedBuilder()
    .setAuthor({ name: number ? `Заявка на верификацию №${number}` : 'Заявка на верификацию' })
    .setThumbnail(user.displayAvatarURL())
    .setColor(0xfee75c)
    .setFooter({ text: `ID: ${user.id}` })
    .setTimestamp();

  embed.addFields(
    { name: 'Участник', value: `<@${user.id}>`, inline: false },
    { name: 'Дата создания аккаунта', value: `<t:${createdTs}:R>`, inline: false },
  );

  for (const q of verifyQuestions.slice(0, 5)) {
    const rawValue = (answers[q.id] ?? '').trim() || '—';
    if (rawValue === '—') {
      embed.addFields({ name: q.label, value: '—' });
      continue;
    }
    const truncated = rawValue.length > 1000 ? rawValue.slice(0, 1000) + '...' : rawValue;
    embed.addFields({ name: q.label, value: `\`${truncated}\`` });
  }
  return embed;
}

export function buildAppealEmbed(
  user: User,
  text: string,
  blacklistReason?: string,
  number?: number,
): EmbedBuilder {
  const createdTs = Math.floor(user.createdTimestamp / 1000);

  const embed = new EmbedBuilder()
    .setAuthor({ name: number ? `Апелляция №${number}` : 'Апелляция' })
    .setThumbnail(user.displayAvatarURL())
    .setColor(0xeb459e)
    .setFooter({ text: `ID: ${user.id}` })
    .setTimestamp();

  embed.addFields(
    { name: 'Участник', value: `<@${user.id}>`, inline: false },
    { name: 'Дата создания аккаунта', value: `<t:${createdTs}:R>`, inline: false },
  );

  const reason = (blacklistReason ?? '').trim();
  if (reason) {
    const truncated = reason.length > 1000 ? reason.slice(0, 1000) + '...' : reason;
    const quoted = truncated
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    embed.addFields({ name: 'Причина ЧС', value: quoted });
  }

  const rawValue = text.trim() || '—';
  if (rawValue === '—') {
    embed.addFields({ name: 'Текст апелляции', value: '—' });
  } else {
    const truncated = rawValue.length > 1000 ? rawValue.slice(0, 1000) + '...' : rawValue;
    embed.addFields({ name: 'Текст апелляции', value: `\`${truncated}\`` });
  }
  return embed;
}

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

export function buildDmEmbed(title: string, description: string, color: number): EmbedBuilder {
  return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

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

export type DecisionKind = 'application' | 'appeal';

export function buildProcessedButtonRow(kind: DecisionKind): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`decision:processed:${kind}`)
      .setLabel(kind === 'appeal' ? 'Апелляция обработана' : 'Анкета обработана')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

export function buildLeftServerButtonRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('decision:left')
      .setLabel('Покинул сервер')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

export function buildAutoClosedButtonRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('decision:expired')
      .setLabel('Закрыто автоматически')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  );
}

export function buildDecisionLinkRow(
  kind: DecisionKind,
  reviewMessageUrl?: string,
): ActionRowBuilder<ButtonBuilder> | undefined {
  if (!reviewMessageUrl) return undefined;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel(kind === 'appeal' ? 'Открыть апелляцию' : 'Открыть анкету')
      .setStyle(ButtonStyle.Link)
      .setURL(reviewMessageUrl),
  );
}

export function buildDecisionEmbed(
  kind: DecisionKind,
  label: string,
  color: number,
  reviewerId: string,
  targetUserId: string,
  reason?: { title: string; text: string },
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setAuthor({ name: kind === 'appeal' ? 'Решение по апелляции' : 'Решение по заявке' })
    .setColor(color)
    .addFields({ name: 'Участник', value: `<@${targetUserId}>`, inline: true });

  if (reason) {
    embed.addFields({
      name: reason.title,
      value: reason.text ? `\`${reason.text}\`` : '—',
      inline: true,
    });
  } else {
    embed.addFields({ name: 'Решение', value: label, inline: true });
  }

  embed
    .addFields({ name: 'Модератор', value: `<@${reviewerId}>`, inline: false })
    .setFooter({ text: `ID: ${targetUserId}` })
    .setTimestamp();

  return embed;
}

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
    reason?: { title: string; text: string };
  },
): Promise<void> {
  if (!channelId) return;
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      console.error('[decision] decisions channel unavailable:', channelId);
      return;
    }
    const embed = buildDecisionEmbed(
      kind,
      opts.label,
      opts.color,
      opts.reviewerId,
      opts.targetUserId,
      opts.reason,
    );
    const linkRow = buildDecisionLinkRow(kind, opts.reviewMessageUrl);
    await (channel as TextChannel).send({
      embeds: [embed],
      components: linkRow ? [linkRow] : [],
    });
  } catch (e) {
    console.error('[decision] failed to post decision message', e);
  }
}
