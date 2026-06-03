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
    userId TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    guildId TEXT NOT NULL,
    answers TEXT NOT NULL,
    submittedAt INTEGER NOT NULL,
    status TEXT NOT NULL,
    reviewMessageUrl TEXT,
    reviewerId TEXT,
    reason TEXT,
    questionChannelId TEXT
  );

  CREATE TABLE IF NOT EXISTS appeals (
    userId TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    submittedAt INTEGER NOT NULL,
    status TEXT NOT NULL,
    reviewMessageUrl TEXT,
    reviewerId TEXT,
    reason TEXT,
    resolvedAt INTEGER,
    questionChannelId TEXT,
    blacklistReason TEXT
  );
`);

try {
  db.exec('ALTER TABLE applications ADD COLUMN questionChannelId TEXT;');
} catch {
}

try {
  db.exec('ALTER TABLE appeals ADD COLUMN reviewMessageUrl TEXT;');
} catch {
}

try {
  db.exec('ALTER TABLE appeals ADD COLUMN resolvedAt INTEGER;');
} catch {
}

try {
  db.exec('ALTER TABLE appeals ADD COLUMN questionChannelId TEXT;');
} catch {
}

try {
  db.exec('ALTER TABLE appeals ADD COLUMN blacklistReason TEXT;');
} catch {
}

export function closeDb(): void {
  try {
    db.close();
  } catch {
  }
}

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

export function listPendingApplications(): Application[] {
  const rows = selectPendingApps.all() as unknown as AppRow[];
  return rows.map(rowToApp);
}

const selectAppsWithQuestionChannel = db.prepare(
  'SELECT * FROM applications WHERE questionChannelId IS NOT NULL',
);

export function listApplicationsWithQuestionChannel(): Application[] {
  const rows = selectAppsWithQuestionChannel.all() as unknown as AppRow[];
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

const claimApp = db.prepare(
  `UPDATE applications SET status = @to, reviewerId = @reviewerId, reason = @reason
   WHERE userId = @userId AND status = 'pending'`,
);

export function claimApplication(
  userId: string,
  to: ApplicationStatus,
  reviewerId: string,
  reason?: string,
): boolean {
  const result = claimApp.run({ userId, to, reviewerId, reason: reason ?? null });
  return result.changes === 1;
}

const markAppLeftStmt = db.prepare(
  "UPDATE applications SET status = 'left' WHERE userId = ? AND status = 'pending'",
);

export function markApplicationLeft(userId: string): boolean {
  return markAppLeftStmt.run(userId).changes === 1;
}

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
  questionChannelId: string | null;
  blacklistReason: string | null;
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
    questionChannelId: row.questionChannelId ?? undefined,
    blacklistReason: row.blacklistReason ?? undefined,
  };
}

const insertAppeal = db.prepare(`
  INSERT INTO appeals (userId, username, text, submittedAt, status, reviewMessageUrl, reviewerId, reason, resolvedAt, questionChannelId, blacklistReason)
  VALUES (@userId, @username, @text, @submittedAt, @status, @reviewMessageUrl, @reviewerId, @reason, @resolvedAt, @questionChannelId, @blacklistReason)
  ON CONFLICT(userId) DO UPDATE SET
    username = excluded.username,
    text = excluded.text,
    submittedAt = excluded.submittedAt,
    status = excluded.status,
    reviewMessageUrl = excluded.reviewMessageUrl,
    reviewerId = excluded.reviewerId,
    reason = excluded.reason,
    resolvedAt = excluded.resolvedAt,
    questionChannelId = excluded.questionChannelId,
    blacklistReason = excluded.blacklistReason
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
    questionChannelId: appeal.questionChannelId ?? null,
    blacklistReason: appeal.blacklistReason ?? null,
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

const claimAppealStmt = db.prepare(
  `UPDATE appeals SET status = @to, reviewerId = @reviewerId, reason = @reason, resolvedAt = @resolvedAt
   WHERE userId = @userId AND status = 'pending'`,
);

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

const markAppealLeftStmt = db.prepare(
  "UPDATE appeals SET status = 'left' WHERE userId = ? AND status = 'pending'",
);

export function markAppealLeft(userId: string): boolean {
  return markAppealLeftStmt.run(userId).changes === 1;
}
