import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { config } from './config';
import { BotClient } from './types';
import { loadCommands, loadButtons, loadModals } from './handlers/loader';
import { handleInteraction } from './handlers/interactionCreate';
import { closeDb } from './storage';
import { registerTagRoleEvents, syncAllTagRoles } from './roleTag';
import { registerLeaveCleanupEvents } from './leaveCleanup';
import { registerQuestionCleanup } from './questionCleanup';
import { registerApplicationCleanup } from './applicationCleanup';

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

  registerTagRoleEvents(client);

  registerLeaveCleanupEvents(client);

  registerQuestionCleanup(client);

  registerApplicationCleanup(client);

  client.once('clientReady', (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    void syncAllTagRoles(c);
  });

  client.on('error', (err) => console.error('[client error]', err));
  client.on('shardError', (err) => console.error('[shard error]', err));

  client.on('interactionCreate', (interaction) => handleInteraction(client, interaction));

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] received ${signal}, closing...`);
    closeDb();
    await client.destroy();
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void shutdown(sig);
    });
  }

  await client.login(config.token);
}

bootstrap().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
