import { REST, Routes } from 'discord.js';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { getAppConfig } from './config';
import { getAppConfigValue, setAppConfigValue } from './storage';
import { SlashCommand } from './types';

let cachedBodies: unknown[] | null = null;
let cachedHash: string | null = null;

export async function buildCommandBodies(): Promise<unknown[]> {
  if (cachedBodies) return cachedBodies;

  const commandsDir = path.join(__dirname, 'commands');
  const files = (await fs.readdir(commandsDir)).filter(
    (f) => (f.endsWith('.ts') || f.endsWith('.js')) && !f.endsWith('.d.ts'),
  );

  const bodies: unknown[] = [];
  for (const f of files) {
    const mod = await import(path.join(commandsDir, f));
    const cmd: SlashCommand = mod.default;
    bodies.push(cmd.data.toJSON());
  }

  cachedBodies = bodies;
  cachedHash = createHash('sha1').update(JSON.stringify(bodies)).digest('hex');
  return bodies;
}

let rest: REST | null = null;

function getRest(): REST {
  if (!rest) rest = new REST({ version: '10' }).setToken(getAppConfig().token);
  return rest;
}

export async function registerCommandsForGuild(guildId: string, force = false): Promise<void> {
  const body = await buildCommandBodies();
  const hashKey = `commandsHash:${guildId}`;

  if (!force) {
    const stored = await getAppConfigValue(hashKey).catch(() => undefined);
    if (stored && stored === cachedHash) return;
  }

  await getRest().put(Routes.applicationGuildCommands(getAppConfig().clientId, guildId), { body });
  if (cachedHash) await setAppConfigValue(hashKey, cachedHash);
  console.log(`[commands] зарегистрировано ${body.length} команд для гильдии ${guildId}`);
}
