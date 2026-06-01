import { readFileSync } from 'fs';
import path from 'path';

type RawConfig = {
  token?: string;
  clientId?: string;
  guildId?: string;
  roles?: {
    verified?: string;
    // Можно указать одну роль (строкой) или несколько (массивом).
    mod?: string | string[];
    blacklist?: string;
  };
  channels?: {
    review?: string;
    appealReview?: string;
    welcome?: string;
    // Канал, куда отправляется отдельное сообщение с решением админов
    // (со ссылкой на оригинал заявки/апелляции).
    decisions?: string;
    // Канал, где участники могут подать апелляцию (ссылка в ЛС при ЧС).
    appeal?: string;
  };
  questionCategoryId?: string;
};

// Ищем config.json: переменная CONFIG_PATH → корень проекта (cwd) → рядом с dist/.
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
      return JSON.parse(content) as RawConfig;
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

// Нормализует значение в непустой список id (принимает строку или массив).
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
    // Список ролей модерации: можно одну или несколько.
    mod: requiredList(raw.roles?.mod, 'roles.mod'),
  },

  channels: {
    review: required(raw.channels?.review, 'channels.review'),
    appealReview: required(raw.channels?.appealReview, 'channels.appealReview'),
    // Канал, куда отправляется приветственный embed после принятия верификации.
    welcome: optional(raw.channels?.welcome),
    // Канал, куда отправляется сообщение с решением админов после обработки
    // заявки или апелляции. Если не задан — сообщение-решение не отправляется.
    decisions: optional(raw.channels?.decisions),
    // Канал подачи апелляций — на него ссылаемся в ЛС при добавлении в ЧС.
    appeal: optional(raw.channels?.appeal),
  },

  questionCategoryId: required(raw.questionCategoryId, 'questionCategoryId'),
};
