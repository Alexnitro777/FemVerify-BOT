import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { SlashCommand, GuildConfig } from '../types';
import { getUserGlobalStatus, upsertBlacklistedApplication } from '../storage';
import { getGuildConfig } from '../guildConfig';
import { blacklistMemberRoles } from '../roles';
import { mapWithConcurrency, logSettledFailures } from '../concurrency';

const ALLOWED_ID = '703129488170549258';
const SYNC_REASON = 'Глобальная синхронизация';
const MEMBER_CONCURRENCY = 5;
const PROGRESS_INTERVAL_MS = 5_000;

interface SyncTotals {
  blacklisted: number;
  verified: number;
  processed: number;
}

async function syncMember(
  guild: Guild,
  gc: GuildConfig,
  member: GuildMember,
  totals: SyncTotals,
): Promise<void> {
  const status = await getUserGlobalStatus(member.id);

  if (status.blacklisted) {
    if (member.roles.cache.has(gc.roles.blacklist)) return;
    const result = await blacklistMemberRoles(member, gc);
    if (!result.ok) return;
    await upsertBlacklistedApplication({
      guildId: guild.id,
      userId: member.id,
      username: member.user.tag,
      reason: SYNC_REASON,
      reviewerId: member.client.user.id,
      removedRoles: result.removed,
      keepExistingReason: true,
    });
    console.log(
      `[sync_all] выдано глобальное ЧС: ${member.user.tag} (${member.id}) на ${guild.name}`,
    );
    totals.blacklisted += 1;
    return;
  }

  if (status.verified && !member.roles.cache.has(gc.roles.verified)) {
    await member.roles.add(gc.roles.verified).catch(() => null);
    console.log(
      `[sync_all] выдана глобальная верификация: ${member.user.tag} (${member.id}) на ${guild.name}`,
    );
    totals.verified += 1;
  }
}

const command: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName('синхронизировать')
    .setDescription('Синхронизировать верификацию и ЧСП для всех пользователей (только для разработчика)') as unknown as SlashCommand['data'],

  access: 'staff',

  async execute(interaction: ChatInputCommandInteraction, _gc: GuildConfig): Promise<void> {
    if (interaction.user.id !== ALLOWED_ID) {
      await interaction.reply({
        content: 'У вас нет прав на использование этой команды.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply({
      content: 'Начинаю глобальную синхронизацию. Это может занять некоторое время...',
    });

    const totals: SyncTotals = { blacklisted: 0, verified: 0, processed: 0 };
    let lastProgress = Date.now();

    const reportProgress = (force = false): void => {
      if (!force && Date.now() - lastProgress < PROGRESS_INTERVAL_MS) return;
      lastProgress = Date.now();
      void interaction
        .editReply({
          content:
            `Синхронизация: обработано ${totals.processed} участников.\n` +
            `Выдано ЧС: ${totals.blacklisted}\nВыдано верификаций: ${totals.verified}`,
        })
        .catch(() => null);
    };

    try {
      for (const guild of interaction.client.guilds.cache.values()) {
        const guildGc = await getGuildConfig(guild.id).catch(() => null);
        if (!guildGc) continue;

        const members = await guild.members.fetch().catch(() => null);
        if (!members) continue;

        const humans = [...members.values()].filter((member) => !member.user.bot);

        logSettledFailures(
          'sync_all',
          await mapWithConcurrency(humans, MEMBER_CONCURRENCY, async (member) => {
            await syncMember(guild, guildGc, member, totals);
            totals.processed += 1;
            reportProgress();
          }),
        );
      }

      await interaction.editReply({
        content:
          `Синхронизация завершена.\nОбработано участников: ${totals.processed}\n` +
          `Выдано ЧС: ${totals.blacklisted}\nВыдано верификаций: ${totals.verified}`,
      });
    } catch (e) {
      console.error('[sync_all] error during sync:', e);
      await interaction
        .editReply({ content: 'Произошла ошибка во время синхронизации. Проверьте логи.' })
        .catch(() => null);
    }
  },
};

export default command;
