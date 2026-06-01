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
    // Роли администраторов: видят и используют все команды бота.
    admin?: string | string[];
    blacklist?: string;
    // Роль, которая автоматически выдаётся участникам с тегом этого сервера.
    roleTag?: string;
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
    // Канал для embed-логов выдачи/снятия роли за тег сервера.
    tagLog?: string;
  };
  questionCategoryId?: string;
};

// Убирает комментарии (// и /* */) из JSON, не трогая содержимое строк.
// Это позволяет держать пояснения прямо в config.json (формат JSONC).
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
    // Список ролей администраторов: видят все команды бота.
    admin: requiredList(raw.roles?.admin, 'roles.admin'),
    // Список ролей модерации: видят /тег /формы /формычсп.
    mod: requiredList(raw.roles?.mod, 'roles.mod'),
    // Роль за тег сервера. Необязательна: если не задана — автовыдача отключена.
    roleTag: optional(raw.roles?.roleTag),
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
    // Канал для embed-логов роли за тег сервера. Если не задан — логи не отправляются.
    tagLog: optional(raw.channels?.tagLog),
  },

  questionCategoryId: required(raw.questionCategoryId, 'questionCategoryId'),
};
