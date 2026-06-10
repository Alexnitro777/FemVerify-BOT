import { readFileSync } from 'fs';
import path from 'path';

type RawConfig = {
  token?: string;
  clientId?: string;
  guildId?: string;
  roles?: {
    verified?: string;
    mod?: string | string[];
    admin?: string | string[];
    blacklist?: string;
    roleTag?: string;
  };
  channels?: {
    review?: string;
    appealReview?: string;
    welcome?: string;
    decisions?: string;
    appeal?: string;
    tagLog?: string;
    blacklistLog?: string;
  };
  questionCategoryId?: string;
};

function stripJsonComments(input: string): string {
  let result = '';
  let inString = false;
  let inSingleLine = false;
  let inMultiLine = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inSingleLine) {
      if (ch === '\n') {
        inSingleLine = false;
        result += ch;
      }
      continue;
    }
    if (inMultiLine) {
      if (ch === '*' && next === '/') {
        inMultiLine = false;
        i++;
      }
      continue;
    }
    if (inString) {
      result += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inSingleLine = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inMultiLine = true;
      i++;
      continue;
    }
    result += ch;
  }

  return result;
}

function loadRawConfig(): RawConfig {
  const candidates = [
    process.env.CONFIG_PATH,
    path.resolve(process.cwd(), 'config.json'),
    path.resolve(__dirname, '..', 'config.json'),
    path.resolve(__dirname, 'config.json'),
  ].filter((p): p is string => Boolean(p));

  for (const file of candidates) {
    try {
      const content = readFileSync(file, 'utf-8');
      return JSON.parse(stripJsonComments(content)) as RawConfig;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') continue;
      throw new Error(`Failed to read config file ${file}: ${(err as Error).message}`);
    }
  }

  throw new Error(
    'Config file not found. Create config.json (copy from config.example.json) ' +
      'in the project root, or set CONFIG_PATH to its location.',
  );
}

const raw = loadRawConfig();

function required(value: string | undefined, name: string): string {
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required config value: ${name}`);
  }
  return String(value);
}

function optional(value: string | undefined): string | undefined {
  return value && String(value).trim() ? String(value) : undefined;
}

function requiredList(value: string | string[] | undefined, name: string): string[] {
  const arr = (Array.isArray(value) ? value : [value])
    .map((v) => (v == null ? '' : String(v).trim()))
    .filter((v) => v.length > 0);
  if (arr.length === 0) {
    throw new Error(`Missing required config value: ${name}`);
  }
  return arr;
}

export const config = {
  token: required(raw.token, 'token'),
  clientId: required(raw.clientId, 'clientId'),
  guildId: required(raw.guildId, 'guildId'),

  roles: {
    verified: required(raw.roles?.verified, 'roles.verified'),
    blacklist: required(raw.roles?.blacklist, 'roles.blacklist'),
    admin: requiredList(raw.roles?.admin, 'roles.admin'),
    mod: requiredList(raw.roles?.mod, 'roles.mod'),
    roleTag: optional(raw.roles?.roleTag),
  },

  channels: {
    review: required(raw.channels?.review, 'channels.review'),
    appealReview: required(raw.channels?.appealReview, 'channels.appealReview'),
    welcome: optional(raw.channels?.welcome),
    decisions: optional(raw.channels?.decisions),
    appeal: optional(raw.channels?.appeal),
    tagLog: optional(raw.channels?.tagLog),
    blacklistLog: optional(raw.channels?.blacklistLog),
  },

  questionCategoryId: required(raw.questionCategoryId, 'questionCategoryId'),
};
