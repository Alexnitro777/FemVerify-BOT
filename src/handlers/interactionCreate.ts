import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Interaction,
  MessageFlags,
  ModalSubmitInteraction,
} from 'discord.js';
import { performance } from 'perf_hooks';
import { BotClient, GuildConfig } from '../types';
import { hasCommandAccess } from '../permissions';
import { getGuildConfig } from '../guildConfig';

const NOT_CONFIGURED = '⚠️ Бот не настроен на этом сервере. Обратитесь к администрации.';
const GUILD_ONLY = 'Действие доступно только на сервере.';
const STALE_BUTTON = '⚠️ Кнопка устарела — обновите сообщение и попробуйте снова.';
const STALE_MODAL = '⚠️ Форма устарела — откройте её заново.';
const NO_ACCESS = '⛔ У тебя нет доступа к этой команде.';

const SLOW_HANDLER_MS = 500;
const SLOW_GATEWAY_MS = 300;

type ComponentInteraction = ButtonInteraction | ModalSubmitInteraction;

interface ComponentHandler<I extends ComponentInteraction> {
  execute: (interaction: I, gc: GuildConfig) => Promise<void>;
}

function interactionLabel(interaction: Interaction): string {
  if (interaction.isChatInputCommand()) return `/${interaction.commandName}`;
  if (interaction.isButton() || interaction.isModalSubmit()) return interaction.customId;
  return interaction.type.toString();
}

async function runComponent<I extends ComponentInteraction>(
  interaction: I,
  handler: ComponentHandler<I> | undefined,
  staleMessage: string,
): Promise<void> {
  if (!handler) {
    await interaction
      .reply({ content: staleMessage, flags: MessageFlags.Ephemeral })
      .catch(() => null);
    return;
  }

  if (!interaction.inGuild()) {
    await interaction.reply({ content: GUILD_ONLY, flags: MessageFlags.Ephemeral });
    return;
  }

  const gc = await getGuildConfig(interaction.guildId);
  if (!gc) {
    await interaction.reply({ content: NOT_CONFIGURED, flags: MessageFlags.Ephemeral });
    return;
  }

  await handler.execute(interaction, gc);
}

async function runChatInputCommand(
  client: BotClient,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;

  if (!interaction.inGuild()) {
    await interaction.reply({ content: GUILD_ONLY, flags: MessageFlags.Ephemeral });
    return;
  }

  const gc = await getGuildConfig(interaction.guildId);
  if (!gc) {
    await interaction.reply({ content: NOT_CONFIGURED, flags: MessageFlags.Ephemeral });
    return;
  }

  if (!hasCommandAccess(interaction, gc, cmd.access ?? 'owner')) {
    await interaction.reply({ content: NO_ACCESS, flags: MessageFlags.Ephemeral });
    return;
  }

  await cmd.execute(interaction, gc);
}

async function dispatch(client: BotClient, interaction: Interaction): Promise<void> {
  if (interaction.isChatInputCommand()) {
    await runChatInputCommand(client, interaction);
    return;
  }
  if (interaction.isButton()) {
    await runComponent(interaction, client.buttons.find(interaction.customId), STALE_BUTTON);
    return;
  }
  if (interaction.isModalSubmit()) {
    await runComponent(interaction, client.modals.find(interaction.customId), STALE_MODAL);
  }
}

async function reportError(interaction: Interaction, err: unknown): Promise<void> {
  console.error('Interaction error:', err);
  if (!interaction.isRepliable()) return;

  const message = 'Произошла ошибка при обработке.';
  if (interaction.deferred && !interaction.isMessageComponent()) {
    await interaction.editReply({ content: message }).catch(() => null);
    return;
  }
  if (interaction.deferred || interaction.replied) {
    await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }
  await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
}

export async function handleInteraction(client: BotClient, interaction: Interaction): Promise<void> {
  const gatewayLag = Date.now() - interaction.createdTimestamp;
  const start = performance.now();

  try {
    await dispatch(client, interaction);
  } catch (err) {
    await reportError(interaction, err);
  } finally {
    const took = performance.now() - start;
    if (took > SLOW_HANDLER_MS || gatewayLag > SLOW_GATEWAY_MS) {
      console.warn(
        `[slow] ${interactionLabel(interaction)}: lag=${gatewayLag}ms, handler=${Math.round(took)}ms`,
      );
    }
  }
}
