import {
  ButtonInteraction,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  GuildMember,
  MessageFlags,
} from 'discord.js';
import { ButtonHandler, GuildConfig } from '../types';
import { appealQuestions } from '../questions';
import { getAppeal } from '../storage';

const DENY_COOLDOWN_MS = 48 * 60 * 60 * 1000;

const handler: ButtonHandler = {
  customId: 'appeal:start',

  async execute(interaction: ButtonInteraction, gc: GuildConfig): Promise<void> {
    const member = interaction.member as GuildMember | null;
    if (!member) {
      await interaction.reply({
        content: 'Апелляция доступна только участникам в чёрном списке.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const availableBlacklists: { type: string; label: string }[] = [];

    if (member.roles.cache.has(gc.roles.blacklist)) {
      availableBlacklists.push({ type: 'ЧСП', label: 'ЧСП' });
    }
    if (gc.roles.blacklistZ && member.roles.cache.has(gc.roles.blacklistZ)) {
      availableBlacklists.push({ type: 'ЧСЗ', label: 'ЧСЗ' });
    }
    if (gc.roles.blacklistA && member.roles.cache.has(gc.roles.blacklistA)) {
      availableBlacklists.push({ type: 'ЧСА', label: 'ЧСА' });
    }

    if (availableBlacklists.length === 0) {
      await interaction.reply({
        content: 'Апелляция доступна только участникам в чёрном списке.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = await getAppeal(interaction.guildId!, interaction.user.id);
    if (existing?.status === 'pending') {
      await interaction.reply({ content: 'Ваша апелляция уже на рассмотрении.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (existing?.status === 'denied' && existing.resolvedAt) {
      const availableAt = existing.resolvedAt + DENY_COOLDOWN_MS;
      if (Date.now() < availableAt) {
        const ts = Math.floor(availableAt / 1000);
        await interaction.reply({
          content:
            `⛔ Вашу прошлую апелляцию отклонили. Новую можно подать <t:${ts}:R> (<t:${ts}:f>).`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    if (availableBlacklists.length > 1) {
      // User has multiple blacklist roles, let them choose
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const bl of availableBlacklists) {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`appeal:select_type:${bl.type}`)
            .setLabel(bl.label)
            .setStyle(ButtonStyle.Primary)
        );
      }
      await interaction.reply({
        content: 'Пожалуйста, выберите тип блокировки, которую вы хотите обжаловать:',
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // User has exactly 1 blacklist role
    const selectedType = availableBlacklists[0].type;
    const modal = new ModalBuilder().setCustomId(`appeal:submit:${selectedType}`).setTitle(`Апелляция: ${selectedType}`);
    const rows = appealQuestions.slice(0, 5).map((q) => {
      const input = new TextInputBuilder()
        .setCustomId(q.id)
        .setLabel(q.label)
        .setStyle(q.style)
        .setRequired(q.required);
      if (q.minLength) input.setMinLength(q.minLength);
      if (q.maxLength) input.setMaxLength(q.maxLength);
      if (q.placeholder) input.setPlaceholder(q.placeholder);
      return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    });
    modal.addComponents(...rows);
    await interaction.showModal(modal);
  },
};

export default handler;
