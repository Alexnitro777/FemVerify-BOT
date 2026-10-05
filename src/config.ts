import { getAppConfigValue, setAppConfigValue } from './storage';

export interface AppConfig {
  token: string;
  clientId: string;
  mainGuildId?: string;
  mainGuildInvite?: string;
}

let cached: AppConfig | null = null;

async function resolve(key: string, envName: string): Promise<string> {
  const fromDb = await getAppConfigValue(key);
  if (fromDb && fromDb.trim()) return fromDb.trim();

  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) {
    const value = fromEnv.trim();
    await setAppConfigValue(key, value);
    return value;
  }

  throw new Error(
    `Missing ${key}. Insert it into the app_config table (key='${key}'), ` +
      `or set ${envName} once so the bot can persist it.`,
  );
}

async function resolveOptional(key: string, envName: string): Promise<string | undefined> {
  const fromDb = await getAppConfigValue(key);
  if (fromDb && fromDb.trim()) return fromDb.trim();

  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) {
    const value = fromEnv.trim();
    await setAppConfigValue(key, value);
    return value;
  }

  return undefined;
}

export async function initAppConfig(): Promise<void> {
  const token = await resolve('token', 'BOT_TOKEN');
  const clientId = await resolve('clientId', 'CLIENT_ID');
  const mainGuildId = await resolveOptional('mainGuildId', 'MAIN_GUILD_ID');
  const mainGuildInvite = await resolveOptional('mainGuildInvite', 'MAIN_GUILD_INVITE');
  cached = { token, clientId, mainGuildId, mainGuildInvite };
}

export function getAppConfig(): AppConfig {
  if (!cached) {
    throw new Error('App config not initialized. Call initAppConfig() before getAppConfig().');
  }
  return cached;
}

export function getMainGuildId(): string | undefined {
  return cached?.mainGuildId;
}

export function getMainGuildInvite(): string | undefined {
  return cached?.mainGuildInvite;
}

export function isMainGuild(guildId: string | null | undefined): boolean {
  if (!cached?.mainGuildId) return true;
  return !!guildId && cached.mainGuildId === guildId;
}
