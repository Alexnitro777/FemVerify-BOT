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

try {
  db.exec('ALTER TABLE applications ADD COLUMN number INTEGER;');
} catch {
}

try {
  db.exec('ALTER TABLE appeals ADD COLUMN number INTEGER;');
} catch {
}

try {
  db.exec('ALTER TABLE applications ADD COLUMN joinMethod TEXT;');
} catch {
}

db.exec(`
  CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS join_methods (
    userId TEXT PRIMARY KEY,
    method TEXT NOT NULL,
    joinedAt INTEGER NOT NULL
  );
`);

const insertJoinMethod = db.prepare(`
  INSERT INTO join_methods (userId, method, joinedAt) VALUES (@userId, @method, @joinedAt)
  ON CONFLICT(userId) DO UPDATE SET
    method = excluded.method,
    joinedAt = excluded.joinedAt
`);

export function saveJoinMethod(userId: string, method: string): void {
  insertJoinMethod.run({ userId, method, joinedAt: Date.now() });
}

const selectJoinMethod = db.prepare('SELECT method FROM join_methods WHERE userId = ?');

export function getJoinMethod(userId: string): string | undefined {
  const row = selectJoinMethod.get(userId) as { method: string } | undefined;
  return row?.method;
}

const bumpCounter = db.prepare(`
  INSERT INTO counters (name, value) VALUES (?, 1)
  ON CONFLICT(name) DO UPDATE SET value = value + 1
  RETURNING value
`);

function nextNumber(name: string): number {
  const row = bumpCounter.get(name) as { value: number };
  return row.value;
}

export function nextApplicationNumber(): number {
  return nextNumber('application');
}

export function nextAppealNumber(): number {
  return nextNumber('appeal');
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
  number: number | null;
  joinMethod: string | null;
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
    number: row.number ?? undefined,
    joinMethod: row.joinMethod ?? undefined,
  };
}

const insertApp = db.prepare(`
  INSERT INTO applications (userId, username, guildId, answers, submittedAt, status, reviewMessageUrl, reviewerId, reason, questionChannelId, number, joinMethod)
  VALUES (@userId, @username, @guildId, @answers, @submittedAt, @status, @reviewMessageUrl, @reviewerId, @reason, @questionChannelId, @number, @joinMethod)
  ON CONFLICT(userId) DO UPDATE SET
    username = excluded.username,
    answers = excluded.answers,
    submittedAt = excluded.submittedAt,
    status = excluded.status,
    reviewMessageUrl = excluded.reviewMessageUrl,
    reviewerId = excluded.reviewerId,
    reason = excluded.reason,
    questionChannelId = excluded.questionChannelId,
    number = excluded.number,
    joinMethod = excluded.joinMethod
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
    number: app.number ?? null,
    joinMethod: app.joinMethod ?? null,
  });
}

const reserveAppStmt = db.prepare(`
  INSERT INTO applications (userId, username, guildId, answers, submittedAt, status, reviewMessageUrl, reviewerId, reason, questionChannelId, number, joinMethod)
  VALUES (@userId, @username, @guildId, @answers, @submittedAt, @status, @reviewMessageUrl, @reviewerId, @reason, @questionChannelId, @number, @joinMethod)
  ON CONFLICT(userId) DO UPDATE SET
    username = excluded.username,
    guildId = excluded.guildId,
    answers = excluded.answers,
    submittedAt = excluded.submittedAt,
    status = excluded.status,
    reviewMessageUrl = excluded.reviewMessageUrl,
    reviewerId = excluded.reviewerId,
    reason = excluded.reason,
    questionChannelId = excluded.questionChannelId,
    number = excluded.number,
    joinMethod = excluded.joinMethod
  WHERE applications.status != 'pending'
`);

export function reserveApplication(app: Application): boolean {
  return (
    reserveAppStmt.run({
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
      number: app.number ?? null,
      joinMethod: app.joinMethod ?? null,
    }).changes === 1
  );
}

const claimAppQuestionChannelStmt = db.prepare(
  `UPDATE applications SET questionChannelId = @newId
   WHERE userId = @userId AND questionChannelId IS @oldId`,
);

export function claimApplicationQuestionChannel(
  userId: string,
  newId: string,
  oldId: string | null,
): boolean {
  return claimAppQuestionChannelStmt.run({ userId, newId, oldId: oldId ?? null }).changes === 1;
}

const selectApp = db.prepare('SELECT * FROM applications WHERE userId = ?');

export function getApplication(userId: string): Application | undefined {
  const row = selectApp.get(userId) as AppRow | undefined;
  return row ? rowToApp(row) : undefined;
}

const selectAppByQuestionChannel = db.prepare(
  'SELECT * FROM applications WHERE questionChannelId = ?',
);

export function getApplicationByQuestionChannel(channelId: string): Application | undefined {
  const row = selectAppByQuestionChannel.get(channelId) as AppRow | undefined;
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
  number: number | null;
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
    number: row.number ?? undefined,
  };
}

const insertAppeal = db.prepare(`
  INSERT INTO appeals (userId, username, text, submittedAt, status, reviewMessageUrl, reviewerId, reason, resolvedAt, questionChannelId, blacklistReason, number)
  VALUES (@userId, @username, @text, @submittedAt, @status, @reviewMessageUrl, @reviewerId, @reason, @resolvedAt, @questionChannelId, @blacklistReason, @number)
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
    blacklistReason = excluded.blacklistReason,
    number = excluded.number
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
    number: appeal.number ?? null,
  });
}

const reserveAppealStmt = db.prepare(`
  INSERT INTO appeals (userId, username, text, submittedAt, status, reviewMessageUrl, reviewerId, reason, resolvedAt, questionChannelId, blacklistReason, number)
  VALUES (@userId, @username, @text, @submittedAt, @status, @reviewMessageUrl, @reviewerId, @reason, @resolvedAt, @questionChannelId, @blacklistReason, @number)
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
    blacklistReason = excluded.blacklistReason,
    number = excluded.number
  WHERE appeals.status != 'pending'
`);

export function reserveAppeal(appeal: Appeal): boolean {
  return (
    reserveAppealStmt.run({
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
      number: appeal.number ?? null,
    }).changes === 1
  );
}

const claimAppealQuestionChannelStmt = db.prepare(
  `UPDATE appeals SET questionChannelId = @newId
   WHERE userId = @userId AND questionChannelId IS @oldId`,
);

export function claimAppealQuestionChannel(
  userId: string,
  newId: string,
  oldId: string | null,
): boolean {
  return claimAppealQuestionChannelStmt.run({ userId, newId, oldId: oldId ?? null }).changes === 1;
}

const selectAppeal = db.prepare('SELECT * FROM appeals WHERE userId = ?');

export function getAppeal(userId: string): Appeal | undefined {
  const row = selectAppeal.get(userId) as AppealRow | undefined;
  return row ? rowToAppeal(row) : undefined;
}

const selectAppealByQuestionChannel = db.prepare(
  'SELECT * FROM appeals WHERE questionChannelId = ?',
);

export function getAppealByQuestionChannel(channelId: string): Appeal | undefined {
  const row = selectAppealByQuestionChannel.get(channelId) as AppealRow | undefined;
  return row ? rowToAppeal(row) : undefined;
}

const selectPendingAppeals = db.prepare(
  "SELECT * FROM appeals WHERE status = 'pending' ORDER BY submittedAt ASC",
);

export function listPendingAppeals(): Appeal[] {
  const rows = selectPendingAppeals.all() as unknown as AppealRow[];
  return rows.map(rowToAppeal);
}

const selectAppealsWithQuestionChannel = db.prepare(
  'SELECT * FROM appeals WHERE questionChannelId IS NOT NULL',
);

export function listAppealsWithQuestionChannel(): Appeal[] {
  const rows = selectAppealsWithQuestionChannel.all() as unknown as AppealRow[];
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
