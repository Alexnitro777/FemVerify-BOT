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
	getAppealById,
	claimAppeal,
	claimAppealQuestionChannel,
	getApplication,
	amnestyApplication,
	getPendingAppeals,
	removeSpecialBlacklist,
	recordQuestionCreated,
	setAppealReviewMessage,
} from '../storage';
import {
	buildDmEmbed,
	postDecisionMessage,
	buildAppealReviewButtons,
	markReviewMessageResolved,
} from '../ui';
import { deleteQuestionChannel } from '../channels';
import { hasButtonAccess, getGuild } from '../permissions';
import { liftProjectBlacklist } from '../roles';
import { removeGlobalBlacklist } from '../sync';
import { logSettledFailures, runUserExclusive } from '../concurrency';
import { APPEAL_DENY_COOLDOWN_MS } from '../appealPolicy';

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

function blacklistRoleFor(gc: GuildConfig, blacklistType: string | undefined): string | undefined {
	if (blacklistType === 'ЧСЗ') return gc.roles.blacklistZ;
	if (blacklistType === 'ЧСА') return gc.roles.blacklistA;
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
	appealId: number,
): Promise<void> {
	await interaction.deferUpdate();
	await runUserExclusive(userId, async () => {

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
			appealId,
		);
		if (!reserved) {
			const fresh = await getAppealById(guild.id, appealId);
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
			await claimAppealQuestionChannel(guild.id, userId, null, placeholder, appealId);
			await interaction.followUp({ content: LEFT_SERVER, flags: MessageFlags.Ephemeral });
			return;
		}

		const channel = await guild.channels
			.create({
				name: `вопрос-${member.user.username}`.slice(0, 90),
				type: ChannelType.GuildText,
				parent: gc.questionCategoryId,
				topic: `femverify:question:appeal:${userId}:${appealId}`,
				permissionOverwrites: [
					{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
					{ id: interaction.client.user!.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
					{
						id: userId,
						allow: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.SendMessages,
							PermissionFlagsBits.ReadMessageHistory,
							PermissionFlagsBits.AttachFiles,
							PermissionFlagsBits.EmbedLinks,
						],
					},
					...gc.roles.ststaff.map((roleId) => ({
						id: roleId,
						allow: [
							PermissionFlagsBits.ViewChannel,
							PermissionFlagsBits.SendMessages,
							PermissionFlagsBits.ReadMessageHistory,
							PermissionFlagsBits.AttachFiles,
							PermissionFlagsBits.EmbedLinks,
						],
					})),
				],
			})
			.catch((e) => {
				console.error('[appealReview] не удалось создать канал-вопрос', e);
				return null;
			});

		if (!channel) {
			await claimAppealQuestionChannel(guild.id, userId, null, placeholder, appealId);
			await interaction.followUp({
				content: '❌ Не удалось создать канал с вопросом — проверьте права бота.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		const claimed = await claimAppealQuestionChannel(guild.id, userId, channel.id, placeholder, appealId);
		if (!claimed) {
			await channel.delete('Дублирующий канал-вопрос').catch(() => null);
			const fresh = await getAppealById(guild.id, appealId);
			await interaction.followUp({
				content: fresh?.questionChannelId
					? `Канал с вопросом уже существует: <#${fresh.questionChannelId}>.`
					: 'Канал с вопросом уже создаётся.',
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await recordQuestionCreated(guild.id, channel.id, userId, interaction.user.id, 'appeal');

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
					components: [buildAppealReviewButtons(userId, channel.url, blacklistType, appealId)],
				}),
			]),
		);
	});
}

async function handleDecision(
	interaction: ButtonInteraction,
	gc: GuildConfig,
	guild: Guild | null,
	userId: string,
	blacklistType: string | undefined,
	amnesty: boolean,
	appealId: number,
): Promise<void> {
	await interaction.deferUpdate();
	await runUserExclusive(userId, async () => {
		const guildId = interaction.guildId!;
		const current = await getAppealById(guildId, appealId);
		if (!current || current.userId !== userId || current.status !== 'pending' || (current.blacklistType ?? 'ЧСП') !== (blacklistType ?? 'ЧСП')) {
			await interaction.editReply({ content: 'Апелляция уже обработана или подтверждение устарело.', components: [] });
			return;
		}
		if (amnesty && !blacklistRoleFor(gc, current.blacklistType)) {
			await interaction.editReply({ content: 'Роль этого типа блокировки не настроена. Обратитесь к администратору.', components: [] });
			return;
		}
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
				appealId,
			),
		]);

		if (!claimed) {
			const fresh = await getAppealById(guildId, appealId);
			await interaction.editReply({
				content: `Апелляция уже обработана (${fresh?.status ?? 'не найдена'}).`,
				components: [],
			});
			return;
		}

		const type = claimed.blacklistType ?? 'ЧСП';
		const texts = dmTexts(type);
		const reviewUrl =
			claimed.reviewMessageUrl ??
			(interaction.message.flags.has(MessageFlags.Ephemeral) ? undefined : interaction.message.url);

		const warnings: string[] = [];
		let dmEmbed: EmbedBuilder;

		if (amnesty) {
			if (type === 'ЧСП') {
				await amnestyApplication(guildId, userId);
				if (member && !(await liftProjectBlacklist(member, gc))) {
					warnings.push('⚠️ Не удалось снять ЧС или вернуть все роли. Снимок ролей сохранён для повторной попытки.');
				}
			} else if (type === 'ЧСА' || type === 'ЧСЗ') {
				await removeSpecialBlacklist(guildId, userId, type);
				const roleId = blacklistRoleFor(gc, type)!;
				if (member) {
					try {
						await member.roles.remove(roleId);
					} catch (error) {
						console.error('[appealReview] roles.remove failed', error);
						warnings.push('⚠️ Не удалось снять роль блокировки. Проверьте разрешения и иерархию.');
					}
				}
			}

			dmEmbed = buildDmEmbed('✅ Амнистия принята', texts.accept, 0x57f287);
		} else {
			const ts = Math.floor((Date.now() + APPEAL_DENY_COOLDOWN_MS) / 1000);
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
			await removeGlobalBlacklist(interaction.client, userId, guildId).catch((e) =>
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
					? deleteQuestionChannel(guild, claimed.questionChannelId, {
							reason: label,
							closedByUserId: interaction.user.id,
							targetUserId: userId,
							number: claimed.number,
							reviewMessageUrl: reviewUrl,
							kind: 'appeal',
						})
					: Promise.resolve(),
			]),
		);
	});
}

const handler: ButtonHandler = {
	customId: /^appeal:(amnesty|confirm_amnesty|deny|confirm_deny|cancel|question):\d+(?:_[a-zA-Zа-яА-Я0-9]+)?(?::\d+)?$/,

	async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
		if (!hasButtonAccess(interaction, gc, 'ststaff')) {
			await interaction.reply({ content: 'Недостаточно прав.', flags: MessageFlags.Ephemeral });
			return;
		}

		const [, action, idAndType, rawAppealId] = interaction.customId.split(':');
		const appealId = Number(rawAppealId);
		const [userId, blacklistType] = idAndType.split('_');

		if (action === 'cancel') {
			await interaction.update({ content: '❌ Действие отменено.', components: [] });
			return;
		}

		const guild = getGuild(interaction);

		if (action === 'confirm_amnesty' || action === 'confirm_deny') {
			if (!rawAppealId || !Number.isSafeInteger(appealId) || appealId <= 0) {
				await interaction.update({ content: 'Подтверждение устарело. Откройте актуальную апелляцию.', components: [] });
				return;
			}
			await handleDecision(
				interaction,
				gc,
				guild,
				userId,
				blacklistType,
				action === 'confirm_amnesty',
				appealId,
			);
			return;
		}

		const guildId = interaction.guildId!;
		const pending = await getPendingAppeals(guildId, userId);
		const appeal = rawAppealId
			? pending.find((entry) => entry.id === appealId && (!blacklistType || (entry.blacklistType ?? 'ЧСП') === blacklistType))
			: pending.find((entry) => entry.reviewMessageUrl === interaction.message.url && (!blacklistType || (entry.blacklistType ?? 'ЧСП') === blacklistType));
		if (!appeal) {
			await interaction.reply({ content: 'Апелляция не найдена.', flags: MessageFlags.Ephemeral });
			return;
		}
		if (!appeal.reviewMessageUrl) {
			await setAppealReviewMessage(guildId, appeal.id, interaction.message.url);
			appeal.reviewMessageUrl = interaction.message.url;
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
				appeal.id,
			);
			return;
		}

		await interaction.reply({
			content:
				action === 'amnesty'
					? `❓ Вы действительно хотите **принять амнистию** пользователя <@${userId}>?`
					: `❓ Вы действительно хотите **отклонить амнистию** пользователя <@${userId}>?`,
			components: [buildConfirmRow(`${userId}_${appeal.blacklistType ?? 'ЧСП'}:${appeal.id}`, action === 'amnesty')],
			flags: MessageFlags.Ephemeral,
		});
	},
};

export default handler;
