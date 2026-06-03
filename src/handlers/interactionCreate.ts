import { Interaction, MessageFlags } from 'discord.js';
import { BotClient } from '../types';
import { hasCommandAccess } from '../permissions';

export async function handleInteraction(client: BotClient, interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const cmd = client.commands.get(interaction.commandName);
      if (!cmd) return;
      const required = cmd.access ?? 'admin';
      if (!hasCommandAccess(interaction, required)) {
        await interaction.reply({
          content: '⛔ У тебя нет доступа к этой команде.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await cmd.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      for (const handler of client.buttons.values()) {
        const match =
          handler.customId instanceof RegExp
            ? handler.customId.test(interaction.customId)
            : handler.customId === interaction.customId;
        if (match) {
          await handler.execute(interaction);
          return;
        }
      }
    }

    if (interaction.isModalSubmit()) {
      for (const handler of client.modals.values()) {
        const match =
          handler.customId instanceof RegExp
            ? handler.customId.test(interaction.customId)
            : handler.customId === interaction.customId;
        if (match) {
          await handler.execute(interaction);
          return;
        }
      }
    }
  } catch (err) {
    console.error('Interaction error:', err);
    if (!interaction.isRepliable()) return;
    const message = 'Произошла ошибка при обработке.';
    if (interaction.isMessageComponent() && (interaction.deferred || interaction.replied)) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
    } else if (interaction.deferred) {
      await interaction.editReply({ content: message }).catch(() => null);
    } else if (interaction.replied) {
      await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
    } else {
      await interaction
        .reply({ content: message, flags: MessageFlags.Ephemeral })
        .catch(() => null);
    }
  }
}
