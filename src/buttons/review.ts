import {
	ButtonInteraction,
	EmbedBuilder,
	Guild,
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
import { ButtonHandler, GuildConfig } from '../types';
import {
	getApplication,
	claimApplication,
	updateApplication,
	claimApplicationQuestionChannel,
} from '../storage';
import {
	buildDmEmbed,
	postDecisionMessage,
	buildReviewButtons,
	markReviewMessageResolved,
	postWelcomeMessage,
} from '../ui';
import { deleteQuestionChannel } from '../channels';
import { hasButtonAccess, getGuild } from '../permissions';
import { applyGlobalVerification } from '../sync';
import { logSettledFailures } from '../concurrency';

const LEFT_SERVER = 'Пользователь покинул сервер.';

async function resolveMember(guild: Guild, userId: string) {
	return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
}

async function handleApprove(
	interaction: ButtonInteraction,
	gc: GuildConfig,
	guild: Guild,
	userId: string,
): Promise<void> {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const member = await resolveMember(guild, userId);
	if (!member) {
		await interaction.editReply({ content: LEFT_SERVER });
		return;
	}

	const claimed = await claimApplication(guild.id, userId, 'approved', interaction.user.id);
	if (!claimed) {
		const fresh = await getApplication(guild.id, userId);
		await interaction.editReply({
			content: `Заявка уже обработана (${fresh?.status ?? 'не найдена'}).`,
		});
		return;
	}

	try {
		await member.roles.add(gc.roles.verified);
	} catch (e) {
		console.error('[review] roles.add failed', e);
		await updateApplication(guild.id, userId, {
			status: 'pending',
			reviewerId: undefined,
			questionChannelId: claimed.questionChannelId,
		});
		await interaction.editReply({
			content:
				'❌ Не удалось выдать роль — проверьте, что роль бота выше выдаваемой. Статус заявки возвращён в ожидание.',
		});
		return;
	}

	const accepted = `✅ Анкета пользователя <@${userId}> принята.`;
	await interaction.editReply({ content: accepted, components: [] });

	void applyGlobalVerification(interaction.client, userId, guild.id).catch((e) =>
		console.error('[review] applyGlobalVerification failed', e),
	);

	const reviewUrl =
		claimed.reviewMessageUrl ??
		(interaction.message.flags.has(MessageFlags.Ephemeral) ? undefined : interaction.message.url);

	const results = await Promise.allSettled([
		member
			.send({
				embeds: [buildDmEmbed('✅ Заявка одобрена', 'Добро пожаловать на сервер!', 0x57f287)],
			})
			.then(() => true)
			.catch(() => false),
		markReviewMessageResolved(interaction.client, reviewUrl, {
			kind: 'application',
			label: 'Принято',
			color: 0x57f287,
			reviewerId: interaction.user.id,
			known: interaction.message,
		}),
		postDecisionMessage(interaction.client, gc.channels.decisions, 'application', {
			label: 'Принято',
			color: 0x57f287,
			reviewerId: interaction.user.id,
			targetUserId: userId,
			reviewMessageUrl: reviewUrl,
			number: claimed.number,
		}),
		deleteQuestionChannel(guild, claimed.questionChannelId, 'Заявка одобрена'),
		postWelcomeMessage(interaction.client, gc.channels.welcome, member),
	]);

	logSettledFailures('review', results.slice(1));

	const dmResult = results[0];
	const dmOk = dmResult.status === 'fulfilled' && dmResult.value === true;
	if (!dmOk) {
		await interaction
			.editReply({
				content: `${accepted}\n⚠️ Отправить ЛС не удалось (закрыты личные сообщения).`,
				components: [],
			})
			.catch(() => null);
	}
}

async function handleQuestion(
	interaction: ButtonInteraction,
	gc: GuildConfig,
	guild: Guild,
	userId: string,
	reviewMessageUrl: string | undefined,
	currentQuestionChannelId: string | undefined,
): Promise<void> {
	await interaction.deferUpdate();

	if (currentQuestionChannelId) {
		const existing = await guild.channels.fetch(currentQuestionChannelId).catch(() => null);
		if (existing) {
			await interaction.followUp({
				content: `Канал с вопросом уже существует: <#${existing.id}>.`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
	}

	const placeholder = `pending:${interaction.id}`;
	const reserved = await claimApplicationQuestionChannel(
		guild.id,
		userId,
		placeholder,
		currentQuestionChannelId ?? null,
	);
	if (!reserved) {
		const fresh = await getApplication(guild.id, userId);
		await interaction.followUp({
			content:
				fresh?.questionChannelId && !fresh.questionChannelId.startsWith('pending:')
					? `Канал с вопросом уже существует: <#${fresh.questionChannelId}>.`
					: 'Канал с вопросом уже создаётся.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const member = await resolveMember(guild, userId);
	if (!member) {
		await claimApplicationQuestionChannel(guild.id, userId, null, placeholder);
		await interaction.followUp({ content: LEFT_SERVER, flags: MessageFlags.Ephemeral });
		return;
	}

	const staffRoles = [...new Set([...gc.roles.staff, ...gc.roles.ststaff])];
	const channel = await guild.channels
		.create({
			name: `вопрос-${member.user.username}`.slice(0, 90),
			type: ChannelType.GuildText,
			parent: gc.questionCategoryId,
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
				...staffRoles.map((roleId) => ({
					id: roleId,
					allow: [
						PermissionFlagsBits.ViewChannel,
						PermissionFlagsBits.SendMessages,
						PermissionFlagsBits.ReadMessageHistory,
					],
				})),
			],
		})
		.catch((e) => {
			console.error('[review] не удалось создать канал-вопрос', e);
			return null;
		});

	if (!channel) {
		await claimApplicationQuestionChannel(guild.id, userId, null, placeholder);
		await interaction.followUp({
			content: '❌ Не удалось создать канал с вопросом — проверьте права бота.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const claimed = await claimApplicationQuestionChannel(guild.id, userId, channel.id, placeholder);
	if (!claimed) {
		await channel.delete('Дублирующий канал-вопрос').catch(() => null);
		const fresh = await getApplication(guild.id, userId);
		await interaction.followUp({
			content: fresh?.questionChannelId
				? `Канал с вопросом уже существует: <#${fresh.questionChannelId}>.`
				: 'Канал с вопросом уже создаётся.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

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
			.setURL(reviewMessageUrl ?? interaction.message.url),
		new ButtonBuilder()
			.setCustomId(`question:close:${channel.id}`)
			.setLabel('Закрыть канал')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🗑️'),
	);

	const mentionUserIds = [...new Set([userId, interaction.user.id])];

	logSettledFailures(
		'review',
		await Promise.allSettled([
			channel.send({
				content: mentionUserIds.map((id) => `<@${id}>`).join(' '),
				embeds: [embed],
				components: [row],
				allowedMentions: { users: mentionUserIds },
			}),
			interaction.editReply({ components: [buildReviewButtons(userId, channel.url)] }),
		]),
	);
}

const handler: ButtonHandler = {
	customId: /^review:(approve|reject|question|blacklist):\d+$/,

	async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
		if (!hasButtonAccess(interaction, gc, 'staff')) {
			await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
			return;
		}

		const guild = getGuild(interaction);
		if (!guild) {
			await interaction.reply({
				content: 'Действие доступно только на сервере.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const [, action, userId] = interaction.customId.split(':');

		if (action === 'approve') {
			await handleApprove(interaction, gc, guild, userId);
			return;
		}

		const app = await getApplication(guild.id, userId);
		if (!app) {
			await interaction.reply({ content: 'Заявка не найдена.', flags: MessageFlags.Ephemeral });
			return;
		}

		if (app.status !== 'pending') {
			await interaction.reply({
				content: `Заявка уже обработана (${app.status}).`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (action === 'question') {
			await handleQuestion(
				interaction,
				gc,
				guild,
				userId,
				app.reviewMessageUrl,
				app.questionChannelId,
			);
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
	},
};

export default handler;
