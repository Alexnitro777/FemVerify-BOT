import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config';
import { BotClient } from './types';
import { loadCommands, loadButtons, loadModals } from './handlers/loader';
import { handleInteraction } from './handlers/interactionCreate';
import { closeDb } from './storage';

async function bootstrap(): Promise<void> {
  console.log('[boot] starting...');
  console.log('[boot] node', process.version);
  console.log('[boot] token present:', Boolean(config.token));
  console.log('[boot] clientId present:', Boolean(config.clientId));
  console.log('[boot] guildId present:', Boolean(config.guildId));

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    partials: [Partials.GuildMember],
  }) as BotClient;

  client.commands = new Collection();
  client.buttons = new Collection();
  client.modals = new Collection();

  await loadCommands(client);
  await loadButtons(client);
  await loadModals(client);
  console.log('[boot] handlers loaded, logging in...');

  client.once('clientReady', (c) => {
    console.log(`Logged in as ${c.user.tag}`);
  });

  client.on('error', (err) => console.error('[client error]', err));
  client.on('shardError', (err) => console.error('[shard error]', err));

  client.on('interactionCreate', (interaction) => handleInteraction(client, interaction));

  // Graceful shutdown: закрываем соединение с БД и Discord по сигналу (баг #10).
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] received ${signal}, closing...`);
    closeDb();
    client.destroy();
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => shutdown(sig));
  }

  await client.login(config.token);
}

bootstrap().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
