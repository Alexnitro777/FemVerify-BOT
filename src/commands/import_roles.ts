import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  MessageFlags,
  GuildMember,
} from 'discord.js';
import { SlashCommand, GuildConfig } from '../types';
import { isOwner } from '../permissions';
import {
  getApplication,
  getSpecialBlacklist,
  upsertBlacklistedApplication,
  upsertSpecialBlacklist,
  upsertVerifiedApplication,
} from '../storage';
import { postDecisionMessage } from '../ui';

const DEFAULT_REASON = 'Автовыдача: фикс';
const MESSAGE_DELAY_MS = 350;
const PROGRESS_INTERVAL_MS = 3_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ImportTotals {
  verified: number;
  chsp: number;
  chsz: number;
  chsa: number;
  skipped: number;
  processed: number;
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('внести')
    .setDescription('Внести участников с ролями верификации, ЧСП, ЧСЗ, ЧСА в базу данных и отправить логи')
    .addStringOption((opt) =>
      opt
        .setName('категория')
        .setDescription('Какую категорию внести (по умолчанию: все)')
        .setRequired(false)
        .addChoices(
          { name: 'Все (верификация + ЧСП + ЧСЗ + ЧСА)', value: 'all' },
          { name: 'Только верифицированные', value: 'verified' },
          { name: 'Только ЧСП', value: 'chsp' },
          { name: 'Только ЧСЗ', value: 'chsz' },
          { name: 'Только ЧСА', value: 'chsa' },
        ),
    )
    .addStringOption((opt) =>
      opt
        .setName('причина')
        .setDescription('Причина внесения (по умолчанию: Автовыдача: фикс)')
        .setRequired(false),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as unknown as SlashCommand['data'],

  access: 'owner',

  async execute(interaction: ChatInputCommandInteraction, gc: GuildConfig): Promise<void> {
    if (!interaction.inGuild() || !interaction.guild) {
      await interaction.reply({
        content: 'Команду нужно запускать на сервере.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!isOwner(interaction.user.id)) {
      await interaction.reply({
        content: 'У вас нет прав на использование этой команды.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply({
      content: 'Загрузка списка участников сервера...',
    });

    const category = interaction.options.getString('категория') ?? 'all';
    const reason = (interaction.options.getString('причина') ?? '').trim() || DEFAULT_REASON;

    const guild = interaction.guild;
    const members = await guild.members.fetch().catch(() => null);
    if (!members) {
      await interaction.editReply({
        content: 'Не удалось получить список участников сервера.',
      });
      return;
    }

    const humans = [...members.values()].filter((m) => !m.user.bot);
    const totals: ImportTotals = {
      verified: 0,
      chsp: 0,
      chsz: 0,
      chsa: 0,
      skipped: 0,
      processed: 0,
    };

    let lastProgress = Date.now();
    const reportProgress = async (force = false): Promise<void> => {
      if (!force && Date.now() - lastProgress < PROGRESS_INTERVAL_MS) return;
      lastProgress = Date.now();
      await interaction
        .editReply({
          content:
            `Обработка участников: ${totals.processed} / ${humans.length}\n` +
            `Внесено верификаций: ${totals.verified}\n` +
            `Внесено ЧСП: ${totals.chsp}\n` +
            `Внесено ЧСЗ: ${totals.chsz}\n` +
            `Внесено ЧСА: ${totals.chsa}\n` +
            `Пропущено: ${totals.skipped}`,
        })
        .catch(() => null);
    };

    const decisionsChannel = gc.channels.decisions ?? gc.channels.review;
    const blacklistLogChannel = gc.channels.blacklistLog ?? gc.channels.decisions;

    for (const member of humans) {
      totals.processed += 1;
      const existing = await getApplication(guild.id, member.id).catch(() => null);

      let memberActionTaken = false;

      const hasChsp = member.roles.cache.has(gc.roles.blacklist);
      const hasVerified = member.roles.cache.has(gc.roles.verified);
      const hasChsz = gc.roles.blacklistZ ? member.roles.cache.has(gc.roles.blacklistZ) : false;
      const hasChsa = gc.roles.blacklistA ? member.roles.cache.has(gc.roles.blacklistA) : false;

      if ((category === 'all' || category === 'chsp') && hasChsp) {
        if (existing?.status !== 'blacklisted') {
          await upsertBlacklistedApplication({
            guildId: guild.id,
            userId: member.id,
            username: member.user.tag,
            reason,
            reviewerId: interaction.user.id,
          });
          await postDecisionMessage(interaction.client, blacklistLogChannel, 'application', {
            label: 'ЧСП',
            color: 0x992d22,
            reviewerId: interaction.user.id,
            targetUserId: member.id,
            reason: { title: 'Причина ЧС', text: reason },
            title: 'Выдача ЧСП',
          });
          totals.chsp += 1;
          memberActionTaken = true;
          await sleep(MESSAGE_DELAY_MS);
        }
      }

      if ((category === 'all' || category === 'verified') && hasVerified && !hasChsp) {
        if (existing?.status !== 'approved') {
          await upsertVerifiedApplication({
            guildId: guild.id,
            userId: member.id,
            username: member.user.tag,
            reason,
            reviewerId: interaction.user.id,
          });
          await postDecisionMessage(interaction.client, decisionsChannel, 'application', {
            label: 'Принято',
            color: 0x57f287,
            reviewerId: interaction.user.id,
            targetUserId: member.id,
            reason: { title: 'Причина', text: reason },
            title: 'Внесение в базу данных',
          });
          totals.verified += 1;
          memberActionTaken = true;
          await sleep(MESSAGE_DELAY_MS);
        }
      }

      if ((category === 'all' || category === 'chsz') && hasChsz) {
        const existingChsz = await getSpecialBlacklist(guild.id, member.id, 'ЧСЗ').catch(() => null);
        if (!existingChsz) {
          await upsertSpecialBlacklist({
            guildId: guild.id,
            userId: member.id,
            type: 'ЧСЗ',
            reason,
            reviewerId: interaction.user.id,
          });
          await postDecisionMessage(interaction.client, blacklistLogChannel, 'application', {
            label: 'ЧСЗ',
            color: 0x3498db,
            reviewerId: interaction.user.id,
            targetUserId: member.id,
            reason: { title: 'Причина ЧСЗ', text: reason },
            title: 'Выдача ЧСЗ',
          });
          totals.chsz += 1;
          memberActionTaken = true;
          await sleep(MESSAGE_DELAY_MS);
        }
      }

      if ((category === 'all' || category === 'chsa') && hasChsa) {
        const existingChsa = await getSpecialBlacklist(guild.id, member.id, 'ЧСА').catch(() => null);
        if (!existingChsa) {
          await upsertSpecialBlacklist({
            guildId: guild.id,
            userId: member.id,
            type: 'ЧСА',
            reason,
            reviewerId: interaction.user.id,
          });
          await postDecisionMessage(interaction.client, blacklistLogChannel, 'application', {
            label: 'ЧСА',
            color: 0xe67e22,
            reviewerId: interaction.user.id,
            targetUserId: member.id,
            reason: { title: 'Причина ЧСА', text: reason },
            title: 'Выдача ЧСА',
          });
          totals.chsa += 1;
          memberActionTaken = true;
          await sleep(MESSAGE_DELAY_MS);
        }
      }

      if (!memberActionTaken) {
        totals.skipped += 1;
      }

      await reportProgress();
    }

    await reportProgress(true);

    await interaction
      .editReply({
        content:
          `✅ Внесение завершено!\n\n` +
          `Всего участников проверено: ${totals.processed}\n` +
          `Внесено верификаций: ${totals.verified}\n` +
          `Внесено ЧСП: ${totals.chsp}\n` +
          `Внесено ЧСЗ: ${totals.chsz}\n` +
          `Внесено ЧСА: ${totals.chsa}\n` +
          `Пропущено: ${totals.skipped}\n` +
          `Причина: \`${reason}\``,
      })
      .catch(() => null);
  },
};

export default command;
