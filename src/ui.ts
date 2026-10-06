import {
	EmbedBuilder,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	User,
	GuildMember,
	Client,
	Message,
	TextChannel,
	AttachmentBuilder,
} from 'discord.js';
import { Application, GuildConfig, ModeratorStats } from './types';
import { verifyQuestions } from './questions';
import { isOwner } from './permissions';

export function buildApplicationEmbed(
	user: User,
	answers: Record<string, string>,
	number?: number,
	joinMethod?: string,
	joinedTimestamp?: number | null,
): EmbedBuilder {
	const createdTs = Math.floor(user.createdTimestamp / 1000);

	const embed = new EmbedBuilder()
		.setTitle(number ? `Заявка на верификацию №\`${number}\`` : 'Заявка на верификацию')
		.setThumbnail(user.displayAvatarURL())
		.setColor(0xfee75c)
		.setFooter({ text: `ID: ${user.id}` })
		.setTimestamp();

	embed.addFields(
		{ name: 'Участник', value: `<@${user.id}>`, inline: false },
		{ name: 'Дата создания аккаунта', value: `<t:${createdTs}:R>`, inline: true },
		{
			name: 'Дата захода',
			value: joinedTimestamp ? `<t:${Math.floor(joinedTimestamp / 1000)}:R>` : '—',
			inline: true,
		},
		{
			name: 'Способ вступления',
			value: joinMethod?.trim() || 'Неизвестно',
			inline: true,
		},
	);

	verifyQuestions.slice(0, 5).forEach((q) => {
		const rawValue = (answers[q.id] ?? '').trim() || '—';
		const value =
			rawValue === '—'
				? '—'
				: `\`${rawValue.length > 1000 ? rawValue.slice(0, 1000) + '...' : rawValue}\``;

		embed.addFields({ name: q.label, value, inline: false });
	});
	return embed;
}

export function buildAppealEmbed(
	user: User,
	text: string,
	blacklistReason?: string,
	number?: number,
	blacklistType?: string,
): EmbedBuilder {
	const createdTs = Math.floor(user.createdTimestamp / 1000);

	const embed = new EmbedBuilder()
		.setTitle(number ? `Апелляция №\`${number}\`` : 'Апелляция')
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
		const quoted = reason
			.split('\n')
			.map((line) => `> ${line}`)
			.join('\n');
		const value = quoted.length > 1000 ? quoted.slice(0, 1000) + '…' : quoted;
		embed.addFields({ name: 'Причина ЧС', value });
	}

	if (blacklistType) {
		embed.addFields({ name: 'Тип блокировки', value: blacklistType });
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

const PAGE_SIZE = 10;

interface PendingListItem {
	userId: string;
	username: string;
	submittedAt: number;
	reviewMessageUrl?: string;
	number?: number;
	questionChannelId?: string;
}

export function buildPendingListView(
	items: PendingListItem[],
	requestedPage: number,
	opts: { title: string; color: number; namespace: string },
): { embed: EmbedBuilder; row?: ActionRowBuilder<ButtonBuilder> } {
	const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
	const page = Math.min(Math.max(0, requestedPage), pages - 1);
	const start = page * PAGE_SIZE;
	const slice = items.slice(start, start + PAGE_SIZE);

	const lines = slice.map((item, i) => {
		const idx = start + i;
		const ts = Math.floor(item.submittedAt / 1000);
		const link = item.reviewMessageUrl ? ` — [перейти](${item.reviewMessageUrl})` : '';
		const num = item.number ? `№\`${item.number}\`` : `\`${idx + 1}.\``;
		const question = item.questionChannelId
			? ` • <#${item.questionChannelId}>`
			: '';
		return `**${num}** <@${item.userId}> (${item.username}) — <t:${ts}:R>${link}${question}`;
	});

	const embed = new EmbedBuilder()
		.setTitle(`${opts.title} — ${items.length}`)
		.setColor(opts.color)
		.setDescription(lines.join('\n').slice(0, 4096))
		.setFooter({ text: `Страница ${page + 1}/${pages}` });

	let row: ActionRowBuilder<ButtonBuilder> | undefined;
	if (pages > 1) {
		row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setCustomId(`${opts.namespace}:page:${page - 1}`)
				.setLabel('◀ Назад')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page <= 0),
			new ButtonBuilder()
				.setCustomId(`${opts.namespace}:pageinfo`)
				.setLabel(`${page + 1} / ${pages}`)
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(true),
			new ButtonBuilder()
				.setCustomId(`${opts.namespace}:page:${page + 1}`)
				.setLabel('Вперёд ▶')
				.setStyle(ButtonStyle.Secondary)
				.setDisabled(page >= pages - 1),
		);
	}

	return { embed, row };
}


export function buildReviewButtons(
	userId: string,
	questionChannelUrl?: string,
): ActionRowBuilder<ButtonBuilder> {
	const questionButton = questionChannelUrl
		? new ButtonBuilder()
				.setLabel('Перейти к вопросу')
				.setStyle(ButtonStyle.Link)
				.setURL(questionChannelUrl)
				.setEmoji('❓')
		: new ButtonBuilder()
				.setCustomId(`review:question:${userId}`)
				.setLabel('Задать вопрос')
				.setStyle(ButtonStyle.Primary)
				.setEmoji('❓');

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
		questionButton,
		new ButtonBuilder()
			.setCustomId(`review:blacklist:${userId}`)
			.setLabel('ЧС')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('🚫'),
	);
}

export function buildAppealReviewButtons(
	userId: string,
	questionChannelUrl?: string,
	blacklistType?: string,
): ActionRowBuilder<ButtonBuilder> {
	const idSuffix = blacklistType ? `${userId}_${blacklistType}` : userId;

	const questionButton = questionChannelUrl
		? new ButtonBuilder()
				.setLabel('Перейти к вопросу')
				.setStyle(ButtonStyle.Link)
				.setURL(questionChannelUrl)
				.setEmoji('❓')
		: new ButtonBuilder()
				.setCustomId(`appeal:question:${idSuffix}`)
				.setLabel('Задать вопрос')
				.setStyle(ButtonStyle.Primary)
				.setEmoji('❓');

	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`appeal:amnesty:${idSuffix}`)
			.setLabel('Принять амнистию')
			.setStyle(ButtonStyle.Success)
			.setEmoji('✅'),
		new ButtonBuilder()
			.setCustomId(`appeal:deny:${idSuffix}`)
			.setLabel('Отказать в амнистии')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('❌'),
		questionButton,
	);
}

export function buildResolvedEmbed(
	original: EmbedBuilder,
	label: string,
	color: number,
	reviewerId: string,
	reason?: { title: string; text: string },
): EmbedBuilder {
	const embed = EmbedBuilder.from(original.data).setColor(color).addFields({
		name: label,
		value: `<@${reviewerId}>`,
		inline: Boolean(reason),
	});
	if (reason) {
		const text = reason.text.trim();
		const value = text ? `\`${text.length > 1000 ? text.slice(0, 1000) + '...' : text}\`` : '—';
		embed.addFields({ name: reason.title, value, inline: true });
	}
	return embed;
}

export function buildDmEmbed(title: string, description: string, color: number): EmbedBuilder {
	return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}

export function parseMessageUrl(url: string): { channelId: string; messageId: string } | null {
	const parsed = url.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
	return parsed ? { channelId: parsed[2], messageId: parsed[3] } : null;
}

export async function resolveReviewMessage(
	client: Client,
	reviewMessageUrl: string | undefined,
	known?: Message | null,
): Promise<Message | null> {
	if (!reviewMessageUrl) return null;
	if (known && known.url === reviewMessageUrl) return known;

	const parsed = parseMessageUrl(reviewMessageUrl);
	if (!parsed) return null;

	const channel = await client.channels.fetch(parsed.channelId).catch(() => null);
	if (!channel?.isTextBased()) return null;

	return (channel as TextChannel).messages.fetch(parsed.messageId).catch(() => null);
}

export async function markReviewMessageResolved(
	client: Client,
	reviewMessageUrl: string | undefined,
	opts: {
		kind: DecisionKind;
		label: string;
		color: number;
		reviewerId: string;
		reason?: { title: string; text: string };
		row?: ActionRowBuilder<ButtonBuilder>;
		known?: Message | null;
	},
): Promise<void> {
	const message = await resolveReviewMessage(client, reviewMessageUrl, opts.known);
	if (!message || !message.embeds[0]) return;

	const resolved = buildResolvedEmbed(
		EmbedBuilder.from(message.embeds[0]),
		opts.label,
		opts.color,
		opts.reviewerId,
		opts.reason,
	);
	await message
		.edit({
			embeds: [resolved],
			components: [opts.row ?? buildProcessedButtonRow(opts.kind)],
		})
		.catch((e) => {
			console.error('[ui] не удалось обновить сообщение ревью', e);
			return null;
		});
}

export async function postWelcomeMessage(
	client: Client,
	channelId: string | undefined,
	member: GuildMember,
): Promise<void> {
	if (!channelId) return;
	try {
		const channel = await client.channels.fetch(channelId).catch(() => null);
		if (!channel?.isTextBased()) return;
		await (channel as TextChannel).send({
			content: `<@${member.id}>`,
			embeds: [buildWelcomeEmbed(member)],
			allowedMentions: { users: [member.id] },
		});
	} catch (e) {
		console.error('[ui] не удалось отправить приветствие', e);
	}
}

export function buildWelcomeEmbed(member: GuildMember): EmbedBuilder {
	const { guild, user } = member;

	return new EmbedBuilder()
		.setTitle('🎉  Добро пожаловать!')
		.setDescription(
			`Добро пожаловать, <@${user.id}>, на **${guild.name}**! Мы рады, что вы присоединились к нам для общения.`,
		)
		.setThumbnail(user.displayAvatarURL())
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
	number?: number,
	reason?: { title: string; text: string },
	titleOverride?: string,
): EmbedBuilder {
	const embed = new EmbedBuilder()
		.setTitle(
			titleOverride
				? number
					? `${titleOverride} №\`${number}\``
					: titleOverride
				: kind === 'appeal'
					? number
						? `Решение по апелляции №\`${number}\``
						: 'Решение по апелляции'
					: number
						? `Решение по заявке №\`${number}\``
						: 'Решение по заявке',
		)
		.setColor(color)
		.addFields({ name: 'Участник', value: `<@${targetUserId}>`, inline: true });

	if (reason) {
		const text = reason.text.trim();
		embed.addFields({
			name: reason.title,
			value: text ? `\`${text.length > 1000 ? text.slice(0, 1000) + '...' : text}\`` : '—',
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
		number?: number;
		title?: string;
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
			opts.number,
			opts.reason,
			opts.title,
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

export interface QuestionLogInfo {
	channelName: string;
	channelId: string;
	targetUserId: string;
	closedByUserId?: string;
	closeReason?: string;
	messageCount: number;
	reviewMessageUrl?: string;
	kind?: DecisionKind;
	number?: number;
}

function formatMskDateTime(date: Date): string {
	const parts = new Intl.DateTimeFormat('ru-RU', {
		timeZone: 'Europe/Moscow',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
	return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} MSK`;
}

function formatMskFileTimestamp(date: Date): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Europe/Moscow',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).formatToParts(date);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
	return `${get('year')}-${get('month')}-${get('day')}_${get('hour')}-${get('minute')}-${get('second')}`;
}

export function formatQuestionTranscript(messages: Message[]): string {
	const userMessages = messages.filter((m) => !m.author.bot);
	const lines: string[] = [];

	for (const msg of userMessages) {
		const time = formatMskDateTime(msg.createdAt);
		const author = `${msg.author.username} (${msg.author.id})`;
		const content = msg.cleanContent || msg.content || '';
		lines.push(`[${time}] ${author}:`);
		if (content) {
			lines.push(content);
		}
		if (msg.attachments.size > 0) {
			for (const att of msg.attachments.values()) {
				lines.push(`[Вложение: ${att.url}]`);
			}
		}
		if (msg.embeds.length > 0) {
			for (const emb of msg.embeds) {
				const title = emb.title ? ` ${emb.title}` : '';
				const desc = emb.description ? ` - ${emb.description}` : '';
				lines.push(`[Embed${title}${desc}]`);
			}
		}
		lines.push('');
	}

	return lines.join('\n').trim();
}

export function buildQuestionLogEmbed(info: QuestionLogInfo): EmbedBuilder {
	const title = info.number
		? info.kind === 'appeal'
			? `Лог вопроса • Апелляция №\`${info.number}\``
			: `Лог вопроса • Заявка №\`${info.number}\``
		: `Лог вопроса • #${info.channelName}`;

	const embed = new EmbedBuilder()
		.setTitle(title)
		.setColor(0x5865f2)
		.addFields(
			{ name: 'Участник', value: `<@${info.targetUserId}>`, inline: true },
			{
				name: 'Закрыл',
				value: info.closedByUserId ? `<@${info.closedByUserId}>` : 'Система / обработка',
				inline: true,
			},
			{ name: 'Сообщений', value: String(info.messageCount), inline: true },
		);

	if (info.closeReason) {
		embed.addFields({ name: 'Действие', value: info.closeReason, inline: true });
	}

	embed.setFooter({ text: `ID: ${info.targetUserId}` }).setTimestamp();
	return embed;
}

export async function postQuestionLogMessage(
	client: Client,
	channelId: string | undefined,
	info: QuestionLogInfo,
	transcript: string,
): Promise<void> {
	if (!channelId) return;
	try {
		const channel = await client.channels.fetch(channelId).catch(() => null);
		if (!channel || !channel.isTextBased()) {
			console.error('[questionLog] log channel unavailable:', channelId);
			return;
		}
		const embed = buildQuestionLogEmbed(info);
		const linkRow = info.reviewMessageUrl && info.kind
			? buildDecisionLinkRow(info.kind, info.reviewMessageUrl)
			: undefined;
		const cleanName = info.channelName.replace(/^вопрос-?/i, '').replace(/[^a-zA-Z0-9_-]/g, '') || info.targetUserId;
		const timeStr = formatMskFileTimestamp(new Date());
		const attachment = new AttachmentBuilder(Buffer.from(`\uFEFF${transcript}`, 'utf-8'), {
			name: `question-${cleanName}-${timeStr}.txt`,
		});
		await (channel as TextChannel).send({
			embeds: [embed],
			files: [attachment],
			components: linkRow ? [linkRow] : [],
		});
	} catch (e) {
		console.error('[questionLog] failed to post question log message', e);
	}
}

function getModeratorRankLabel(
	member: GuildMember | null,
	gc: GuildConfig,
): string | null {
	if (member && member.roles && member.roles.cache) {
		const roleIds = Array.from(member.roles.cache.keys());
		const ststaffRoles = gc.roles.ststaff.filter((id) => roleIds.includes(id));
		if (ststaffRoles.length > 0) {
			return ststaffRoles.map((id) => `<@&${id}>`).join(' ');
		}
		const staffRoles = gc.roles.staff.filter((id) => roleIds.includes(id));
		if (staffRoles.length > 0) {
			return staffRoles.map((id) => `<@&${id}>`).join(' ');
		}
	}
	return null;
}

export function buildAdminStatEmbed(
	user: User,
	member: GuildMember | null,
	gc: GuildConfig,
	stats: ModeratorStats,
	guildName: string,
	guildIconUrl?: string | null,
): EmbedBuilder {
	const rankLabel = getModeratorRankLabel(member, gc);
	const description = rankLabel
		? `**Модератор:** <@${user.id}> (\`${user.id}\`)\n**Должность:** ${rankLabel}`
		: `**Модератор:** <@${user.id}> (\`${user.id}\`)`;

	const appTotal = stats.applications.total;
	const appApprovePct = appTotal > 0 ? Math.round((stats.applications.approved / appTotal) * 100) : 0;
	const appRejectPct = appTotal > 0 ? Math.round((stats.applications.rejected / appTotal) * 100) : 0;
	const appBlacklistPct = appTotal > 0 ? Math.round((stats.applications.blacklisted / appTotal) * 100) : 0;

	const embed = new EmbedBuilder()
		.setTitle(`📊 Статистика модератора — ${user.displayName || user.username}`)
		.setThumbnail(user.displayAvatarURL())
		.setColor(0x5865f2)
		.setDescription(description)
		.addFields(
			{
				name: '📝 Анкеты на верификацию',
				value:
					`• Всего рассмотрено: **${appTotal}**\n` +
					`├ Принято: **${stats.applications.approved}** (${appApprovePct}%)\n` +
					`├ Отклонено: **${stats.applications.rejected}** (${appRejectPct}%)\n` +
					`└ В чёрный список: **${stats.applications.blacklisted}** (${appBlacklistPct}%)`,
				inline: false,
			},
			{
				name: '⚖️ Апелляции',
				value:
					`• Всего рассмотрено: **${stats.appeals.total}**\n` +
					`├ Амнистировано: **${stats.appeals.amnestied}**\n` +
					`└ Отклонено: **${stats.appeals.denied}**`,
				inline: false,
			},
			{
				name: '❓ Каналы с вопросами',
				value:
					`• Всего создано: **${stats.questions.total}**\n` +
					`├ По анкетам: **${stats.questions.applications}**\n` +
					`└ По апелляциям: **${stats.questions.appeals}**`,
				inline: false,
			},
		);

	if (stats.specialBlacklists > 0) {
		embed.addFields({
			name: '🚫 Чёрные списки',
			value: `• Выдано спец. списков: **${stats.specialBlacklists}**`,
			inline: false,
		});
	}

	embed.addFields({
		name: '📈 Общая активность',
		value: `Всего действий модерации: **${stats.totalActions}**`,
		inline: false,
	});

	embed
		.setFooter({ text: guildName, ...(guildIconUrl ? { iconURL: guildIconUrl } : {}) })
		.setTimestamp();

	return embed;
}

