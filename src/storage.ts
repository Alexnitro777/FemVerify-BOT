// Использует встроенный node:sqlite (Node.js >= 22.5, стабилен в 24+).
// Не требует нативной компиляции, в отличие от better-sqlite3.
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { Application, ApplicationStatus, Appeal, AppealStatus } from './types';

const DATA_DIR = path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'bot.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    userId          TEXT PRIMARY KEY,
    username        TEXT NOT NULL,
    guildId         TEXT NOT NULL,
    answers         TEXT NOT NULL,
    submittedAt     INTEGER NOT NULL,
    status          TEXT NOT NULL,
    reviewMessageUrl TEXT,
    reviewerId      TEXT,
    reason          TEXT,
    questionChannelId TEXT
  );

  CREATE TABLE IF NOT EXISTS appeals (
    userId      TEXT PRIMARY KEY,
    username    TEXT NOT NULL,
    text        TEXT NOT NULL,
    submittedAt INTEGER NOT NULL,
    status      TEXT NOT NULL,
    reviewMessageUrl TEXT,
    reviewerId  TEXT,
    reason      TEXT,
    resolvedAt  INTEGER
  );
`);

// Миграция для БД, созданных до появления колонки questionChannelId.
try {
  db.exec('ALTER TABLE applications ADD COLUMN questionChannelId TEXT;');
} catch {
  // Колонка уже существует — игнорируем.
}

// Миграция для БД, созданных до появления колонки reviewMessageUrl у аппеляций.
try {
  db.exec('ALTER TABLE appeals ADD COLUMN reviewMessageUrl TEXT;');
} catch {
  // Колонка уже существует — игнорируем.
}

// Миграция для БД, созданных до появления колонки resolvedAt у аппеляций.
try {
  db.exec('ALTER TABLE appeals ADD COLUMN resolvedAt INTEGER;');
} catch {
  // Колонка уже существует — игнорируем.
}

/** Корректно закрывает соединение с БД (для graceful shutdown). */
export function closeDb(): void {
  try {
    db.close();
  } catch {
    // Уже закрыто.
  }
}

// --- Applications ---

interface AppRow {
  userId: string;
  username: string;
  guildId: string;
  answers: string;
  submittedAt: number;
  status: ApplicationStatus;
  reviewMessageUrl: string | null;
  reviewerId: string | null;
  reason: string | null;
  questionChannelId: string | null;
}

function rowToApp(row: AppRow): Application {
  return {
    userId: row.userId,
    username: row.username,
    guildId: row.guildId,
    answers: JSON.parse(row.answers),
    submittedAt: row.submittedAt,
    status: row.status,
    reviewMessageUrl: row.reviewMessageUrl ?? undefined,
    reviewerId: row.reviewerId ?? undefined,
    reason: row.reason ?? undefined,
    questionChannelId: row.questionChannelId ?? undefined,
  };
}

const insertApp = db.prepare(`
  INSERT INTO applications (userId, username, guildId, answers, submittedAt, status, reviewMessageUrl, reviewerId, reason, questionChannelId)
  VALUES (@userId, @username, @guildId, @answers, @submittedAt, @status, @reviewMessageUrl, @reviewerId, @reason, @questionChannelId)
  ON CONFLICT(userId) DO UPDATE SET
    username = excluded.username,
    answers = excluded.answers,
    submittedAt = excluded.submittedAt,
    status = excluded.status,
    reviewMessageUrl = excluded.reviewMessageUrl,
    reviewerId = excluded.reviewerId,
    reason = excluded.reason,
    questionChannelId = excluded.questionChannelId
`);

export function saveApplication(app: Application): void {
  insertApp.run({
    userId: app.userId,
    username: app.username,
    guildId: app.guildId,
    answers: JSON.stringify(app.answers),
    submittedAt: app.submittedAt,
    status: app.status,
    reviewMessageUrl: app.reviewMessageUrl ?? null,
    reviewerId: app.reviewerId ?? null,
    reason: app.reason ?? null,
    questionChannelId: app.questionChannelId ?? null,
  });
}

const selectApp = db.prepare('SELECT * FROM applications WHERE userId = ?');

export function getApplication(userId: string): Application | undefined {
  const row = selectApp.get(userId) as AppRow | undefined;
  return row ? rowToApp(row) : undefined;
}

const selectPendingApps = db.prepare(
  "SELECT * FROM applications WHERE status = 'pending' ORDER BY submittedAt ASC",
);

/** Все необработанные заявки на верификацию (status = pending), старые первыми. */
export function listPendingApplications(): Application[] {
  const rows = selectPendingApps.all() as unknown as AppRow[];
  return rows.map(rowToApp);
}

export function updateApplication(
  userId: string,
  patch: Partial<Application>,
): Application | undefined {
  const current = getApplication(userId);
  if (!current) return undefined;
  const updated = { ...current, ...patch };
  saveApplication(updated);
  return updated;
}

// Атомарный переход статуса заявки: меняет статус только если она ещё `pending`.
// Защищает от гонки при одновременном клике двух модераторов — UPDATE с
// условием выполнится ровно один раз, остальные получат changes === 0.
const claimApp = db.prepare(
  `UPDATE applications SET status = @to, reviewerId = @reviewerId, reason = @reason
   WHERE userId = @userId AND status = 'pending'`,
);

/**
 * Пытается «застолбить» заявку, переведя её из `pending` в целевой статус.
 * @returns true только у первого вызвавшего; false если заявка уже обработана.
 */
export function claimApplication(
  userId: string,
  to: ApplicationStatus,
  reviewerId: string,
  reason?: string,
): boolean {
  const result = claimApp.run({ userId, to, reviewerId, reason: reason ?? null });
  return result.changes === 1;
}

// Атомарно помечает заявку как 'left' (участник покинул сервер), только если она
// ещё `pending`. Возвращает true лишь у первого вызвавшего — защита от гонки с
// модератором, обрабатывающим заявку в тот же момент.
const markAppLeftStmt = db.prepare(
  "UPDATE applications SET status = 'left' WHERE userId = ? AND status = 'pending'",
);

export function markApplicationLeft(userId: string): boolean {
  return markAppLeftStmt.run(userId).changes === 1;
}

// --- Appeals ---

interface AppealRow {
  userId: string;
  username: string;
  text: string;
  submittedAt: number;
  status: AppealStatus;
  reviewMessageUrl: string | null;
  reviewerId: string | null;
  reason: string | null;
  resolvedAt: number | null;
}

function rowToAppeal(row: AppealRow): Appeal {
  return {
    userId: row.userId,
    username: row.username,
    text: row.text,
    submittedAt: row.submittedAt,
    status: row.status,
    reviewMessageUrl: row.reviewMessageUrl ?? undefined,
    reviewerId: row.reviewerId ?? undefined,
    reason: row.reason ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined,
  };
}

const insertAppeal = db.prepare(`
  INSERT INTO appeals (userId, username, text, submittedAt, status, reviewMessageUrl, reviewerId, reason, resolvedAt)
  VALUES (@userId, @username, @text, @submittedAt, @status, @reviewMessageUrl, @reviewerId, @reason, @resolvedAt)
  ON CONFLICT(userId) DO UPDATE SET
    username = excluded.username,
    text = excluded.text,
    submittedAt = excluded.submittedAt,
    status = excluded.status,
    reviewMessageUrl = excluded.reviewMessageUrl,
    reviewerId = excluded.reviewerId,
    reason = excluded.reason,
    resolvedAt = excluded.resolvedAt
`);

export function saveAppeal(appeal: Appeal): void {
  insertAppeal.run({
    userId: appeal.userId,
    username: appeal.username,
    text: appeal.text,
    submittedAt: appeal.submittedAt,
    status: appeal.status,
    reviewMessageUrl: appeal.reviewMessageUrl ?? null,
    reviewerId: appeal.reviewerId ?? null,
    reason: appeal.reason ?? null,
    resolvedAt: appeal.resolvedAt ?? null,
  });
}

const selectAppeal = db.prepare('SELECT * FROM appeals WHERE userId = ?');

export function getAppeal(userId: string): Appeal | undefined {
  const row = selectAppeal.get(userId) as AppealRow | undefined;
  return row ? rowToAppeal(row) : undefined;
}

const selectPendingAppeals = db.prepare(
  "SELECT * FROM appeals WHERE status = 'pending' ORDER BY submittedAt ASC",
);

/** Все необработанные аппеляции (status = pending), старые первыми. */
export function listPendingAppeals(): Appeal[] {
  const rows = selectPendingAppeals.all() as unknown as AppealRow[];
  return rows.map(rowToAppeal);
}

export function updateAppeal(userId: string, patch: Partial<Appeal>): Appeal | undefined {
  const current = getAppeal(userId);
  if (!current) return undefined;
  const updated = { ...current, ...patch };
  saveAppeal(updated);
  return updated;
}

// Атомарный переход статуса аппеляции (см. claimApplication).
// Заодно фиксирует resolvedAt — момент, от которого считается cooldown.
const claimAppealStmt = db.prepare(
  `UPDATE appeals SET status = @to, reviewerId = @reviewerId, reason = @reason, resolvedAt = @resolvedAt
   WHERE userId = @userId AND status = 'pending'`,
);

/**
 * Пытается «застолбить» аппеляцию, переведя её из `pending` в целевой статус.
 * @returns true только у первого вызвавшего; false если уже обработана.
 */
export function claimAppeal(
  userId: string,
  to: AppealStatus,
  reviewerId: string,
  reason?: string,
  resolvedAt: number = Date.now(),
): boolean {
  const result = claimAppealStmt.run({
    userId,
    to,
    reviewerId,
    reason: reason ?? null,
    resolvedAt,
  });
  return result.changes === 1;
}

// Атомарно помечает апелляцию как 'left' (участник покинул сервер), только если
// она ещё `pending`. Возвращает true лишь у первого вызвавшего.
const markAppealLeftStmt = db.prepare(
  "UPDATE appeals SET status = 'left' WHERE userId = ? AND status = 'pending'",
);

export function markAppealLeft(userId: string): boolean {
  return markAppealLeftStmt.run(userId).changes === 1;
}
