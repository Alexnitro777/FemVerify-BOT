import {
	ButtonInteraction,
	EmbedBuilder,
	Guild,
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	PermissionFlagsBits,
	MessageFlags,
} from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import {
	getAppeal,
	claimAppeal,
	claimAppealQuestionChannel,
	getApplication,
	amnestyApplication,
	getPendingAppeals,
} from '../storage';
import {
	buildDmEmbed,
	postDecisionMessage,
	buildAppealReviewButtons,
	markReviewMessageResolved,
} from '../ui';
import { deleteQuestionChannel } from '../channels';
import { hasButtonAccess, getGuild } from '../permissions';
import { restoreMemberRoles } from '../roles';
import { removeGlobalBlacklist } from '../sync';
import { logSettledFailures } from '../concurrency';

const DENY_COOLDOWN_MS = 48 * 60 * 60 * 1000;

const LEFT_SERVER = 'Пользователь покинул сервер.';

interface DmTexts {
	accept: string;
	denyPrefix: string;
}

function dmTexts(blacklistType: string | undefined): DmTexts {
	if (blacklistType === 'ЧСП') {
		return {
			accept: 'С вас снят черный список проекта.',
			denyPrefix: 'Ваша апелляция на снятие черного списка проекта отклонена.',
		};
	}
	if (blacklistType === 'ЧСЗ') {
		return {
			accept: 'С вас снят черный список знакомств.',
			denyPrefix: 'Ваша апелляция на снятие черного списка знакомств отклонена.',
		};
	}
	if (blacklistType === 'ЧСА') {
		return {
			accept: 'С вас снят черный список администрации.',
			denyPrefix: 'Ваша апелляция на снятие черного списка администрации отклонена.',
		};
	}
	return { accept: 'С вас снят чёрный список.', denyPrefix: 'Ваша апелляция отклонена.' };
}

function blacklistRoleFor(gc: GuildConfig, blacklistType: string | undefined): string {
	if (blacklistType === 'ЧСЗ' && gc.roles.blacklistZ) return gc.roles.blacklistZ;
	if (blacklistType === 'ЧСА' && gc.roles.blacklistA) return gc.roles.blacklistA;
	return gc.roles.blacklist;
}

async function resolveMember(guild: Guild, userId: string) {
	return guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
}

function buildConfirmRow(idSuffix: string, amnesty: boolean): ActionRowBuilder<ButtonBuilder> {
	return new ActionRowBuilder<ButtonBuilder>().addComponents(
		new ButtonBuilder()
			.setCustomId(`appeal:${amnesty ? 'confirm_amnesty' : 'confirm_deny'}:${idSuffix}`)
			.setLabel('Подтвердить')
			.setStyle(amnesty ? ButtonStyle.Success : ButtonStyle.Danger)
			.setEmoji(amnesty ? '✅' : '⛔'),
		new ButtonBuilder()
			.setCustomId(`appeal:cancel:${idSuffix}`)
			.setLabel('Отмена')
			.setStyle(ButtonStyle.Secondary)
			.setEmoji('❌'),
	);
}

async function handleQuestion(
	interaction: ButtonInteraction,
	gc: GuildConfig,
	guild: Guild,
	userId: string,
	blacklistType: string | undefined,
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
	const reserved = await claimAppealQuestionChannel(
		guild.id,
		userId,
		placeholder,
		currentQuestionChannelId ?? null,
	);
	if (!reserved) {
		const fresh = await getAppeal(guild.id, userId);
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
		await claimAppealQuestionChannel(guild.id, userId, null, placeholder);
		await interaction.followUp({ content: LEFT_SERVER, flags: MessageFlags.Ephemeral });
		return;
	}

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
				...gc.roles.ststaff.map((roleId) => ({
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
			console.error('[appealReview] не удалось создать канал-вопрос', e);
			return null;
		});

	if (!channel) {
		await claimAppealQuestionChannel(guild.id, userId, null, placeholder);
		await interaction.followUp({
			content: '❌ Не удалось создать канал с вопросом — проверьте права бота.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

	const claimed = await claimAppealQuestionChannel(guild.id, userId, channel.id, placeholder);
	if (!claimed) {
		await channel.delete('Дублирующий канал-вопрос').catch(() => null);
		const fresh = await getAppeal(guild.id, userId);
		await interaction.followUp({
			content: fresh?.questionChannelId
				? `Канал с вопросом уже существует: <#${fresh.questionChannelId}>.`
				: 'Канал с вопросом уже создаётся.',
			flags: MessageFlags.Ephemeral,
		});
		return;
	}

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
			.setURL(reviewMessageUrl ?? interaction.message.url),
		new ButtonBuilder()
			.setCustomId(`question:close:${channel.id}`)
			.setLabel('Закрыть вопрос')
			.setStyle(ButtonStyle.Danger)
			.setEmoji('🗑️'),
	);

	const mentionUserIds = [...new Set([userId, interaction.user.id])];

	logSettledFailures(
		'appealReview',
		await Promise.allSettled([
			channel.send({
				content: mentionUserIds.map((id) => `<@${id}>`).join(' '),
				embeds: [embed],
				components: [row],
				allowedMentions: { users: mentionUserIds },
			}),
			interaction.editReply({
				components: [buildAppealReviewButtons(userId, channel.url, blacklistType)],
			}),
		]),
	);
}

async function handleDecision(
	interaction: ButtonInteraction,
	gc: GuildConfig,
	guild: Guild | null,
	userId: string,
	blacklistType: string | undefined,
	amnesty: boolean,
): Promise<void> {
	await interaction.deferUpdate();

	const guildId = interaction.guildId!;
	const [member, claimed] = await Promise.all([
		guild ? resolveMember(guild, userId) : Promise.resolve(null),
		claimAppeal(
			guildId,
			userId,
			amnesty ? 'amnestied' : 'denied',
			interaction.user.id,
			undefined,
			Date.now(),
			blacklistType,
		),
	]);

	if (!claimed) {
		const fresh = await getAppeal(guildId, userId);
		await interaction.editReply({
			content: `Апелляция уже обработана (${fresh?.status ?? 'не найдена'}).`,
			components: [],
		});
		return;
	}

	const type = claimed.blacklistType;
	const texts = dmTexts(type);
	const reviewUrl =
		claimed.reviewMessageUrl ??
		(interaction.message.flags.has(MessageFlags.Ephemeral) ? undefined : interaction.message.url);

	const warnings: string[] = [];
	let dmEmbed: EmbedBuilder;

	if (amnesty) {
		const roleToRemove = blacklistRoleFor(gc, type);
		const [roleRemoved, application] = await Promise.all([
			member
				? member.roles
						.remove(roleToRemove)
						.then(() => true)
						.catch((e) => {
							console.error('[appealReview] roles.remove failed', e);
							return false;
						})
				: Promise.resolve(true),
			getApplication(guildId, userId),
		]);

		if (member && !roleRemoved) {
			warnings.push(
				`⚠️ Не удалось снять роль ЧС (${type ?? 'ЧСП'}) — проверьте иерархию ролей бота.`,
			);
		}

		if (member && application?.removedRoles?.length) {
			const restored = await restoreMemberRoles(member, gc, application.removedRoles);
			if (!restored) {
				warnings.push('⚠️ Не удалось вернуть часть ролей — проверьте иерархию ролей бота.');
			}
		}
		if (application) {
			await amnestyApplication(guildId, userId);
		}

		dmEmbed = buildDmEmbed('✅ Амнистия принята', texts.accept, 0x57f287);
	} else {
		const ts = Math.floor((Date.now() + DENY_COOLDOWN_MS) / 1000);
		dmEmbed = buildDmEmbed(
			'❌ В амнистии отказано',
			`${texts.denyPrefix} ЧС сохраняется.\n\nВы сможете подать новую апелляцию <t:${ts}:R> (<t:${ts}:f>).`,
			0xed4245,
		);
	}

	const statusText = amnesty
		? `✅ Амнистия пользователя <@${userId}> принята.`
		: `❌ Амнистия пользователя <@${userId}> отклонена.`;

	await interaction.editReply({
		content: warnings.length ? `${statusText}\n${warnings.join('\n')}` : statusText,
		components: [],
	});

	if (amnesty && type === 'ЧСП') {
		void removeGlobalBlacklist(interaction.client, userId, guildId).catch((e) =>
			console.error('[appealReview] removeGlobalBlacklist failed', e),
		);
	}

	const label = amnesty ? 'Амнистия принята' : 'В амнистии отказано';
	const color = amnesty ? 0x57f287 : 0xed4245;

	logSettledFailures(
		'appealReview',
		await Promise.allSettled([
			member?.send({ embeds: [dmEmbed] }).catch(() => null) ?? Promise.resolve(null),
			markReviewMessageResolved(interaction.client, reviewUrl, {
				kind: 'appeal',
				label,
				color,
				reviewerId: interaction.user.id,
			}),
			postDecisionMessage(interaction.client, gc.channels.decisions, 'appeal', {
				label,
				color,
				reviewerId: interaction.user.id,
				targetUserId: userId,
				reviewMessageUrl: reviewUrl,
				number: claimed.number,
			}),
			guild
				? deleteQuestionChannel(guild, claimed.questionChannelId, 'Апелляция обработана')
				: Promise.resolve(),
		]),
	);
}

const handler: ButtonHandler = {
	customId: /^appeal:(amnesty|confirm_amnesty|deny|confirm_deny|cancel|question):\d+(?:_[a-zA-Zа-яА-Я0-9]+)?$/,

	async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
		if (!hasButtonAccess(interaction, gc, 'ststaff')) {
			await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
			return;
		}

		const [, action, idAndType] = interaction.customId.split(':');
		const [userId, blacklistType] = idAndType.split('_');

		if (action === 'cancel') {
			await interaction.update({ content: '❌ Действие отменено.', components: [] });
			return;
		}

		const guild = getGuild(interaction);

		if (action === 'confirm_amnesty' || action === 'confirm_deny') {
			await handleDecision(
				interaction,
				gc,
				guild,
				userId,
				blacklistType,
				action === 'confirm_amnesty',
			);
			return;
		}

		const guildId = interaction.guildId!;
		const pending = await getPendingAppeals(guildId, userId);
		const appeal =
			pending.find((a) => (blacklistType ? a.blacklistType === blacklistType : true)) ??
			(await getAppeal(guildId, userId));
		if (!appeal) {
			await interaction.reply({ content: 'Апелляция не найдена.', flags: MessageFlags.Ephemeral });
			return;
		}

		if (appeal.status !== 'pending') {
			await interaction.reply({
				content: `Апелляция уже обработана (${appeal.status}).`,
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		if (action === 'question') {
			if (!guild) {
				await interaction.reply({
					content: 'Действие доступно только на сервере.',
					flags: MessageFlags.Ephemeral,
				});
				return;
			}
			await handleQuestion(
				interaction,
				gc,
				guild,
				userId,
				blacklistType,
				appeal.reviewMessageUrl,
				appeal.questionChannelId,
			);
			return;
		}

		await interaction.reply({
			content:
				action === 'amnesty'
					? `❓ Вы действительно хотите **принять амнистию** пользователя <@${userId}>?`
					: `❓ Вы действительно хотите **отклонить амнистию** пользователя <@${userId}>?`,
			components: [buildConfirmRow(idAndType, action === 'amnesty')],
			flags: MessageFlags.Ephemeral,
		});
	},
};

export default handler;
