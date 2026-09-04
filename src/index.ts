import { Client, Collection, Events, GatewayIntentBits, Options, Partials } from 'discord.js';
import { initAppConfig, getAppConfig } from './config';
import { BotClient } from './types';
import { HandlerRegistry } from './handlers/registry';
import { loadCommands, loadButtons, loadModals } from './handlers/loader';
import { handleInteraction } from './handlers/interactionCreate';
import { initStorage } from './storage';
import { closeDb } from './db';
import { registerTagRoleEvents, syncAllTagRoles } from './roleTag';
import { registerLeaveCleanupEvents } from './leaveCleanup';
import { registerMemberJoin } from './memberJoin';
import { registerQuestionCleanup } from './questionCleanup';
import { registerApplicationCleanup } from './applicationCleanup';
import { registerInviteTracker } from './inviteTracker';
import { registerVoiceKick } from './voiceKick';
import { registerCommandsForGuild, buildCommandBodies } from './commandRegistration';
import { invalidateGuildConfig, warmGuildConfigs } from './guildConfig';
import { mapWithConcurrency, logSettledFailures } from './concurrency';

const SHUTDOWN_TIMEOUT_MS = 8_000;
const COMMAND_REGISTRATION_CONCURRENCY = 5;

async function bootstrap(): Promise<void> {
  console.log('[boot] starting...');
  console.log('[boot] node', process.version);

  await initStorage();
  console.log('[boot] storage ready');

  await initAppConfig();
  const appConfig = getAppConfig();
  console.log('[boot] token present:', Boolean(appConfig.token));
  console.log('[boot] clientId present:', Boolean(appConfig.clientId));

  await buildCommandBodies();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildInvites,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.GuildMember],
    makeCache: Options.cacheWithLimits({
      ...Options.DefaultMakeCacheSettings,
      MessageManager: 0,
      PresenceManager: 0,
      ReactionManager: 0,
      ReactionUserManager: 0,
      GuildEmojiManager: 0,
      GuildStickerManager: 0,
      GuildScheduledEventManager: 0,
      StageInstanceManager: 0,
      ThreadManager: 0,
      ThreadMemberManager: 0,
      AutoModerationRuleManager: 0,
      BaseGuildEmojiManager: 0,
    }),
    sweepers: {
      ...Options.DefaultSweeperSettings,
      users: {
        interval: 3600,
        filter: () => (user) => user.bot && user.id !== user.client.user?.id,
      },
    },
  }) as BotClient;

  client.commands = new Collection();
  client.buttons = new HandlerRegistry();
  client.modals = new HandlerRegistry();

  await Promise.all([loadCommands(client), loadButtons(client), loadModals(client)]);
  console.log('[boot] handlers loaded, logging in...');

  registerTagRoleEvents(client);
  registerLeaveCleanupEvents(client);
  registerMemberJoin(client);
  registerQuestionCleanup(client);
  registerApplicationCleanup(client);
  registerInviteTracker(client);
  registerVoiceKick(client);

  client.once(Events.ClientReady, (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    const guildList = [...c.guilds.cache.values()].map((g) => `  • ${g.name} (${g.id})`).join('\n');
    console.log(`[boot] серверов в кэше: ${c.guilds.cache.size}\n${guildList}`);

    void (async () => {
      const guildIds = [...c.guilds.cache.keys()];
      await warmGuildConfigs(guildIds).catch((e) =>
        console.error('[boot] не удалось прогреть конфигурации гильдий', e),
      );
      logSettledFailures(
        'commands',
        await mapWithConcurrency(guildIds, COMMAND_REGISTRATION_CONCURRENCY, (guildId) =>
          registerCommandsForGuild(guildId),
        ),
      );
      await syncAllTagRoles(c);
    })();
  });

  client.on(Events.GuildCreate, (guild) => {
    invalidateGuildConfig(guild.id);
    void registerCommandsForGuild(guild.id, true).catch((e) =>
      console.error('[commands] не удалось зарегистрировать команды для новой гильдии', guild.id, e),
    );
  });

  client.on(Events.Error, (err) => console.error('[client error]', err));
  client.on(Events.ShardError, (err) => console.error('[shard error]', err));

  client.on(Events.InteractionCreate, (interaction) => handleInteraction(client, interaction));

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] received ${signal}, closing...`);
    const forceExit = setTimeout(() => {
      console.warn('[shutdown] timeout, forcing exit');
      process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    await client.destroy().catch(() => undefined);
    await closeDb();
    clearTimeout(forceExit);
    process.exit(0);
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void shutdown(sig);
    });
  }

  await client.login(appConfig.token);
}

bootstrap().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
