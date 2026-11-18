import { eq, and, desc, isNotNull, inArray, lt, isNull } from 'drizzle-orm';
import { db, pool } from './db';
import * as schema from './schema';
import { Application, ApplicationStatus, Appeal, AppealSubmission, AppealStatus, ModeratorStats } from './types';
import { APPEAL_DENY_COOLDOWN_MS, APPEAL_LIMIT_PER_TYPE } from './appealPolicy';
export { APPEAL_DENY_COOLDOWN_MS, APPEAL_LIMIT_PER_TYPE } from './appealPolicy';

async function addColumnIfMissing(table: string, definition: string): Promise<void> {
  try {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ER_DUP_FIELDNAME') throw err;
  }
}

async function addIndexIfMissing(table: string, name: string, columns: string): Promise<void> {
  try {
    await pool.query(`ALTER TABLE ${table} ADD INDEX ${name} (${columns})`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ER_DUP_KEYNAME') throw err;
  }
}

let initialized = false;

export async function initStorage(): Promise<void> {
  if (initialized) return;

  await pool.query('SELECT 1');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS applications (
      guildId VARCHAR(32) NOT NULL,
      userId VARCHAR(32) NOT NULL,
      username VARCHAR(255) NOT NULL,
      answers TEXT NOT NULL,
      submittedAt BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL,
      reviewMessageUrl TEXT NULL,
      reviewerId VARCHAR(32) NULL,
      reason TEXT NULL,
      questionChannelId VARCHAR(32) NULL,
      number INT NULL,
      joinMethod TEXT NULL,
      removedRoles TEXT NULL,
      PRIMARY KEY (guildId, userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS appeals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guildId VARCHAR(32) NOT NULL,
      userId VARCHAR(32) NOT NULL,
      username VARCHAR(255) NOT NULL,
      text TEXT NOT NULL,
      submittedAt BIGINT NOT NULL,
      status VARCHAR(32) NOT NULL,
      reviewMessageUrl TEXT NULL,
      reviewerId VARCHAR(32) NULL,
      reason TEXT NULL,
      resolvedAt BIGINT NULL,
      questionChannelId VARCHAR(32) NULL,
      blacklistReason TEXT NULL,
      blacklistType VARCHAR(16) NULL,
      number INT NULL,
      INDEX idx_guild_user (guildId, userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS counters (
      guildId VARCHAR(32) NOT NULL,
      name VARCHAR(64) NOT NULL,
      value BIGINT NOT NULL,
      PRIMARY KEY (guildId, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS join_methods (
      guildId VARCHAR(32) NOT NULL,
      userId VARCHAR(32) NOT NULL,
      method TEXT NOT NULL,
      joinedAt BIGINT NOT NULL,
      PRIMARY KEY (guildId, userId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guildId VARCHAR(32) NOT NULL,
      \`key\` VARCHAR(64) NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (guildId, \`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_config (
      \`key\` VARCHAR(64) NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (\`key\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS special_blacklists (
      guildId VARCHAR(32) NOT NULL,
      userId VARCHAR(32) NOT NULL,
      type VARCHAR(16) NOT NULL,
      reason TEXT NULL,
      reviewerId VARCHAR(32) NULL,
      createdAt BIGINT NOT NULL,
      PRIMARY KEY (guildId, userId, type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS questions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      guildId VARCHAR(32) NOT NULL,
      channelId VARCHAR(32) NOT NULL,
      userId VARCHAR(32) NOT NULL,
      moderatorId VARCHAR(32) NOT NULL,
      kind VARCHAR(16) NOT NULL,
      createdAt BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await addColumnIfMissing('applications', 'questionChannelId VARCHAR(32) NULL');
  await addColumnIfMissing('applications', 'number INT NULL');
  await addColumnIfMissing('applications', 'joinMethod TEXT NULL');
  await addColumnIfMissing('applications', 'removedRoles TEXT NULL');

  await addColumnIfMissing('appeals', 'reviewMessageUrl TEXT NULL');
  await addColumnIfMissing('appeals', 'resolvedAt BIGINT NULL');
  await addColumnIfMissing('appeals', 'questionChannelId VARCHAR(32) NULL');
  await addColumnIfMissing('appeals', 'blacklistReason TEXT NULL');
  await addColumnIfMissing('appeals', 'blacklistType VARCHAR(16) NULL');
  await addColumnIfMissing('appeals', 'number INT NULL');

  const [appealIdColumns] = await pool.query("SHOW COLUMNS FROM appeals LIKE 'id'");
  if ((appealIdColumns as unknown[]).length === 0) {
    await pool.query('ALTER TABLE appeals DROP PRIMARY KEY, ADD COLUMN id INT AUTO_INCREMENT PRIMARY KEY FIRST, ADD INDEX idx_guild_user (guildId, userId)');
  }

  await addIndexIfMissing('applications', 'idx_applications_user_status', 'userId, status');
  await addIndexIfMissing('applications', 'idx_applications_status_submitted', 'status, submittedAt');
  await addIndexIfMissing('applications', 'idx_applications_question_channel', 'questionChannelId');
  await addIndexIfMissing('applications', 'idx_applications_guild_reviewer', 'guildId, reviewerId');
  await addIndexIfMissing('appeals', 'idx_appeals_guild_status', 'guildId, status');
  await addIndexIfMissing('appeals', 'idx_appeals_question_channel', 'questionChannelId');
  await addIndexIfMissing('appeals', 'idx_appeals_guild_reviewer', 'guildId, reviewerId');
  await addIndexIfMissing('join_methods', 'idx_join_methods_user', 'userId');
  await addIndexIfMissing('special_blacklists', 'idx_special_blacklists_user', 'userId');
  await addIndexIfMissing('questions', 'idx_questions_guild_mod', 'guildId, moderatorId');

  try {
    const [configRows] = await pool.query("SELECT value FROM app_config WHERE `key` = 'clientId' LIMIT 1");
    const botClientId = (configRows as any[])?.[0]?.value;
    if (botClientId) {
      await pool.execute(
        `UPDATE applications
         SET reviewerId = ?
         WHERE ((answers = '{}' AND status = 'approved') OR reason LIKE 'Автовыдача%')
           AND reviewerId != ?`,
        [botClientId, botClientId],
      );
      await pool.execute(
        `UPDATE special_blacklists
         SET reviewerId = ?
         WHERE reason LIKE 'Автовыдача%'
           AND reviewerId != ?`,
        [botClientId, botClientId],
      );
    }
  } catch (err) {
    console.error('Migration error for import_roles fix:', err);
  }

  initialized = true;
}

export interface UserGlobalStatus {
  blacklisted: boolean;
  verified: boolean;
  joinedBefore: boolean;
}

export async function getUserGlobalStatus(userId: string): Promise<UserGlobalStatus> {
  const [rows] = await pool.execute<any[]>(
    `SELECT
       EXISTS(SELECT 1 FROM applications WHERE userId = ? AND status = 'blacklisted') AS blacklisted,
       EXISTS(SELECT 1 FROM applications WHERE userId = ? AND status = 'approved') AS verified,
       EXISTS(SELECT 1 FROM join_methods WHERE userId = ?) AS joinedBefore`,
    [userId, userId, userId],
  );
  const row = rows[0] ?? {};
  return {
    blacklisted: Number(row.blacklisted) === 1,
    verified: Number(row.verified) === 1,
    joinedBefore: Number(row.joinedBefore) === 1,
  };
}

export async function getGuildSettings(guildId: string): Promise<Record<string, string>> {
  const rows = await db
    .select({ key: schema.guildSettings.key, value: schema.guildSettings.value })
    .from(schema.guildSettings)
    .where(eq(schema.guildSettings.guildId, guildId));

  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.key] = row.value;
  }
  return out;
}

export async function getGuildSettingsBulk(
  guildIds: string[],
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (guildIds.length === 0) return out;

  const rows = await db
    .select({
      guildId: schema.guildSettings.guildId,
      key: schema.guildSettings.key,
      value: schema.guildSettings.value,
    })
    .from(schema.guildSettings)
    .where(inArray(schema.guildSettings.guildId, guildIds));

  for (const guildId of guildIds) out.set(guildId, {});
  for (const row of rows) {
    const entry = out.get(row.guildId);
    if (entry) entry[row.key] = row.value;
  }
  return out;
}

export async function getAppConfigValue(key: string): Promise<string | undefined> {
  const [row] = await db
    .select({ value: schema.appConfig.value })
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, key));

  return row?.value;
}

export async function setAppConfigValue(key: string, value: string): Promise<void> {
  await db
    .insert(schema.appConfig)
    .values({ key, value })
    .onDuplicateKeyUpdate({ set: { value } });
}

export async function saveJoinMethod(
  guildId: string,
  userId: string,
  method: string,
): Promise<void> {
  const joinedAt = Date.now();
  await db
    .insert(schema.joinMethods)
    .values({ guildId, userId, method, joinedAt })
    .onDuplicateKeyUpdate({ set: { method, joinedAt } });
}

export async function getJoinMethod(
  guildId: string,
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .select({ method: schema.joinMethods.method })
    .from(schema.joinMethods)
    .where(and(eq(schema.joinMethods.guildId, guildId), eq(schema.joinMethods.userId, userId)));

  return row?.method;
}

async function nextNumber(guildId: string, name: string): Promise<number> {
  const [result] = await pool.execute<any>(
    `INSERT INTO counters (guildId, name, value) VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)`,
    [guildId, name],
  );
  return Number(result.insertId);
}

export function nextApplicationNumber(guildId: string): Promise<number> {
  return nextNumber(guildId, 'application');
}

export function nextAppealNumber(guildId: string): Promise<number> {
  return nextNumber(guildId, 'appeal');
}

export async function getTrapKicksCount(guildId: string): Promise<number> {
  const [rows] = await pool.execute<any[]>(
    'SELECT value FROM counters WHERE guildId = ? AND name = ?',
    [guildId, 'trap_kicks'],
  );
  if (rows[0]) return Number(rows[0].value);

  const [appRows] = await pool.execute<any[]>(
    'SELECT COUNT(*) as count FROM applications WHERE guildId = ? AND reason = ?',
    [guildId, 'Автовыдача: Взлом/Реклама'],
  );
  const initial = Number(appRows[0]?.count ?? 0);
  await pool.execute(
    `INSERT INTO counters (guildId, name, value) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE value = value`,
    [guildId, 'trap_kicks', initial],
  );
  return initial;
}

export async function incrementTrapKicksCount(guildId: string): Promise<number> {
  await getTrapKicksCount(guildId);
  const [result] = await pool.execute<any>(
    `INSERT INTO counters (guildId, name, value) VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE value = LAST_INSERT_ID(value + 1)`,
    [guildId, 'trap_kicks'],
  );
  return Number(result.insertId);
}

function rowToApp(row: typeof schema.applications.$inferSelect): Application {
  return {
    userId: row.userId,
    username: row.username,
    guildId: row.guildId,
    answers: JSON.parse(row.answers),
    submittedAt: row.submittedAt,
    status: row.status as ApplicationStatus,
    reviewMessageUrl: row.reviewMessageUrl ?? undefined,
    reviewerId: row.reviewerId ?? undefined,
    reason: row.reason ?? undefined,
    questionChannelId: row.questionChannelId ?? undefined,
    number: row.number ?? undefined,
    joinMethod: row.joinMethod ?? undefined,
    removedRoles: row.removedRoles ? JSON.parse(row.removedRoles) : undefined,
  };
}

export async function saveApplication(app: Application): Promise<void> {
  const values = {
    guildId: app.guildId,
    userId: app.userId,
    username: app.username,
    answers: JSON.stringify(app.answers),
    submittedAt: app.submittedAt,
    status: app.status,
    reviewMessageUrl: app.reviewMessageUrl ?? null,
    reviewerId: app.reviewerId ?? null,
    reason: app.reason ?? null,
    questionChannelId: app.questionChannelId ?? null,
    number: app.number ?? null,
    joinMethod: app.joinMethod ?? null,
    removedRoles: app.removedRoles ? JSON.stringify(app.removedRoles) : null,
  };

  await db
    .insert(schema.applications)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        username: values.username,
        answers: values.answers,
        submittedAt: values.submittedAt,
        status: values.status,
        reviewMessageUrl: values.reviewMessageUrl,
        reviewerId: values.reviewerId,
        reason: values.reason,
        questionChannelId: values.questionChannelId,
        number: values.number,
        joinMethod: values.joinMethod,
        removedRoles: values.removedRoles,
      },
    });
}

export async function reserveApplication(app: Application): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<any[]>(
      'SELECT guildId, status, removedRoles FROM applications WHERE userId = ? FOR UPDATE',
      [app.userId],
    );
    if (
      rows.some((row) => row.status === 'blacklisted') ||
      rows.some((row) => row.guildId === app.guildId && row.removedRoles && JSON.parse(row.removedRoles).length > 0) ||
      rows.some((row) => row.guildId === app.guildId && ['pending', 'approved'].includes(row.status))
    ) {
      await conn.rollback();
      return false;
    }
    await conn.execute(
      `INSERT INTO applications (
        guildId, userId, username, answers, submittedAt, status,
        reviewMessageUrl, reviewerId, reason, questionChannelId, number, joinMethod, removedRoles
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        answers = VALUES(answers),
        submittedAt = VALUES(submittedAt),
        status = VALUES(status),
        reviewMessageUrl = VALUES(reviewMessageUrl),
        reviewerId = VALUES(reviewerId),
        reason = VALUES(reason),
        questionChannelId = VALUES(questionChannelId),
        number = VALUES(number),
        joinMethod = VALUES(joinMethod),
        removedRoles = VALUES(removedRoles)`,
      [
        app.guildId,
        app.userId,
        app.username,
        JSON.stringify(app.answers),
        app.submittedAt,
        app.status,
        app.reviewMessageUrl ?? null,
        app.reviewerId ?? null,
        app.reason ?? null,
        app.questionChannelId ?? null,
        app.number ?? null,
        app.joinMethod ?? null,
        app.removedRoles ? JSON.stringify(app.removedRoles) : null,
      ],
    );
    await conn.commit();
    return true;
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function claimApplicationQuestionChannel(
  guildId: string,
  userId: string,
  newId: string | null,
  oldId: string | null,
  expectedNumber?: number,
): Promise<boolean> {
  const [result] = await pool.execute<any>(
    `UPDATE applications SET questionChannelId = ?
     WHERE guildId = ? AND userId = ? AND status = 'pending' AND questionChannelId <=> ?
       ${expectedNumber !== undefined ? 'AND number = ?' : ''}`,
    [newId, guildId, userId, oldId, ...(expectedNumber !== undefined ? [expectedNumber] : [])],
  );
  return result.affectedRows === 1;
}

export async function getApplication(
  guildId: string,
  userId: string,
): Promise<Application | undefined> {
  const [row] = await db
    .select()
    .from(schema.applications)
    .where(and(eq(schema.applications.guildId, guildId), eq(schema.applications.userId, userId)));

  return row ? rowToApp(row) : undefined;
}

export async function getApplicationByQuestionChannel(
  channelId: string,
): Promise<Application | undefined> {
  const [row] = await db
    .select()
    .from(schema.applications)
    .where(eq(schema.applications.questionChannelId, channelId));

  return row ? rowToApp(row) : undefined;
}

export async function listPendingApplications(guildId: string): Promise<Application[]> {
  const rows = await db
    .select()
    .from(schema.applications)
    .where(and(eq(schema.applications.guildId, guildId), eq(schema.applications.status, 'pending')))
    .orderBy(schema.applications.submittedAt);

  return rows.map(rowToApp);
}

export async function listExpiredPendingApplications(
  guildId: string,
  submittedBefore: number,
): Promise<Application[]> {
  const rows = await db
    .select()
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.guildId, guildId),
        eq(schema.applications.status, 'pending'),
        lt(schema.applications.submittedAt, submittedBefore),
      ),
    )
    .orderBy(schema.applications.submittedAt);

  return rows.map(rowToApp);
}

export async function listApplicationQuestionChannelIds(guildId: string): Promise<string[]> {
  const rows = await db
    .select({ questionChannelId: schema.applications.questionChannelId })
    .from(schema.applications)
    .where(
      and(
        eq(schema.applications.guildId, guildId),
        isNotNull(schema.applications.questionChannelId),
      ),
    );

  return rows
    .map((row) => row.questionChannelId)
    .filter((id): id is string => Boolean(id) && !id!.startsWith('pending:'));
}

export async function upsertBlacklistedApplication(entry: {
  guildId: string;
  userId: string;
  username: string;
  reason: string;
  reviewerId: string;
  removedRoles?: string[];
  keepExistingReason?: boolean;
}): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<any[]>(
      'SELECT status, reason, reviewerId, removedRoles FROM applications WHERE guildId = ? AND userId = ? FOR UPDATE',
      [entry.guildId, entry.userId],
    );
    const existing = rows[0];
    const previousRoles: string[] = existing?.removedRoles ? JSON.parse(existing.removedRoles) : [];
    const mergedRoles = [...new Set([...previousRoles, ...(entry.removedRoles ?? [])])];
    const preserveReason = entry.keepExistingReason && existing?.status === 'blacklisted';
    await conn.execute(
      `INSERT INTO applications (
         guildId, userId, username, answers, submittedAt, status, reason, reviewerId, removedRoles
       ) VALUES (?, ?, ?, '{}', ?, 'blacklisted', ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         username = VALUES(username), status = 'blacklisted', reason = VALUES(reason),
         reviewerId = VALUES(reviewerId), questionChannelId = NULL, removedRoles = VALUES(removedRoles)`,
      [
        entry.guildId, entry.userId, entry.username, Date.now(),
        preserveReason ? existing.reason ?? entry.reason : entry.reason,
        preserveReason ? existing.reviewerId ?? entry.reviewerId : entry.reviewerId,
        mergedRoles.length ? JSON.stringify(mergedRoles) : null,
      ],
    );
    await conn.commit();
  } catch (error) {
    await conn.rollback().catch(() => undefined);
    throw error;
  } finally {
    conn.release();
  }
}

export async function upsertVerifiedApplication(entry: {
  guildId: string;
  userId: string;
  username: string;
  reason: string;
  reviewerId: string;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO applications (
       guildId, userId, username, answers, submittedAt, status, reason, reviewerId
     ) VALUES (?, ?, ?, '{}', ?, 'approved', ?, ?)
     ON DUPLICATE KEY UPDATE
       status = 'approved',
       reason = VALUES(reason),
       reviewerId = VALUES(reviewerId),
       questionChannelId = NULL`,
    [
      entry.guildId,
      entry.userId,
      entry.username,
      Date.now(),
      entry.reason,
      entry.reviewerId,
    ],
  );
}

export interface SpecialBlacklistEntry {
  guildId: string;
  userId: string;
  type: string;
  reason?: string;
  reviewerId?: string;
  createdAt: number;
}

export async function getSpecialBlacklist(
  guildId: string,
  userId: string,
  type: string,
): Promise<SpecialBlacklistEntry | null> {
  const [rows] = await pool.execute<any[]>(
    'SELECT guildId, userId, type, reason, reviewerId, createdAt FROM special_blacklists WHERE guildId = ? AND userId = ? AND type = ?',
    [guildId, userId, type],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    guildId: row.guildId,
    userId: row.userId,
    type: row.type,
    reason: row.reason ?? undefined,
    reviewerId: row.reviewerId ?? undefined,
    createdAt: Number(row.createdAt),
  };
}

export async function getSpecialBlacklistsForUser(
  guildId: string,
  userId: string,
): Promise<SpecialBlacklistEntry[]> {
  const [rows] = await pool.execute<any[]>(
    'SELECT guildId, userId, type, reason, reviewerId, createdAt FROM special_blacklists WHERE guildId = ? AND userId = ?',
    [guildId, userId],
  );
  return rows.map((row) => ({
    guildId: row.guildId,
    userId: row.userId,
    type: row.type,
    reason: row.reason ?? undefined,
    reviewerId: row.reviewerId ?? undefined,
    createdAt: Number(row.createdAt),
  }));
}

export async function upsertSpecialBlacklist(entry: {
  guildId: string;
  userId: string;
  type: string;
  reason: string;
  reviewerId: string;
}): Promise<void> {
  await pool.execute(
    `INSERT INTO special_blacklists (
       guildId, userId, type, reason, reviewerId, createdAt
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       reason = VALUES(reason),
       reviewerId = VALUES(reviewerId)`,
    [
      entry.guildId,
      entry.userId,
      entry.type,
      entry.reason,
      entry.reviewerId,
      Date.now(),
    ],
  );
}

export async function removeSpecialBlacklist(
  guildId: string,
  userId: string,
  type: string,
): Promise<void> {
  await pool.execute(
    'DELETE FROM special_blacklists WHERE guildId = ? AND userId = ? AND type = ?',
    [guildId, userId, type],
  );
}

export async function amnestyApplication(guildId: string, userId: string): Promise<boolean> {
  const [result] = await pool.execute<any>(
    "UPDATE applications SET status = 'amnestied' WHERE guildId = ? AND userId = ? AND status = 'blacklisted'",
    [guildId, userId],
  );
  return result.affectedRows === 1;
}

export async function clearApplicationRemovedRoles(
  guildId: string,
  userId: string,
  expectedRoles?: string[],
): Promise<boolean> {
  const [result] = await pool.execute<any>(
    `UPDATE applications SET removedRoles = NULL
     WHERE guildId = ? AND userId = ? AND status = 'amnestied'
       ${expectedRoles !== undefined ? 'AND removedRoles <=> ?' : ''}`,
    [guildId, userId, ...(expectedRoles !== undefined ? [expectedRoles.length ? JSON.stringify(expectedRoles) : null] : [])],
  );
  return result.affectedRows === 1;
}

export async function setApplicationRemovedRoles(
  guildId: string,
  userId: string,
  removedRoles: string[],
): Promise<void> {
  await pool.execute(
    'UPDATE applications SET removedRoles = ? WHERE guildId = ? AND userId = ?',
    [removedRoles.length ? JSON.stringify(removedRoles) : null, guildId, userId],
  );
}

export async function updateApplication(
  guildId: string,
  userId: string,
  patch: Partial<Application>,
): Promise<Application | undefined> {
  const values = applicationPatchValues(patch);
  if (Object.keys(values).length > 0) {
    await db
      .update(schema.applications)
      .set(values)
      .where(and(eq(schema.applications.guildId, guildId), eq(schema.applications.userId, userId)));
  }
  return getApplication(guildId, userId);
}

function applicationPatchValues(patch: Partial<Application>): Partial<typeof schema.applications.$inferInsert> {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof Application>) {
    if (key === 'guildId' || key === 'userId') continue;
    const value = patch[key];
    values[key] = key === 'answers' || key === 'removedRoles'
      ? value === undefined ? null : JSON.stringify(value)
      : value ?? null;
  }
  return values as Partial<typeof schema.applications.$inferInsert>;
}

export async function rollbackApplicationClaim(
  guildId: string,
  userId: string,
  fromStatus: ApplicationStatus,
  expectedNumber: number | undefined,
  patch: Partial<Application>,
): Promise<boolean> {
  const values = applicationPatchValues(patch);
  if (Object.keys(values).length === 0) return false;
  const result = await db
    .update(schema.applications)
    .set(values)
    .where(and(
      eq(schema.applications.guildId, guildId),
      eq(schema.applications.userId, userId),
      eq(schema.applications.status, fromStatus),
      expectedNumber !== undefined ? eq(schema.applications.number, expectedNumber) : isNull(schema.applications.number),
    ));
  return result[0].affectedRows === 1;
}

export interface ClaimedApplication {
  username: string;
  number?: number;
  reviewMessageUrl?: string;
  questionChannelId?: string;
  removedRoles?: string[];
}

export async function claimApplication(
  guildId: string,
  userId: string,
  to: ApplicationStatus,
  reviewerId: string,
  reason?: string,
  expectedNumber?: number,
): Promise<ClaimedApplication | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    if (to === 'approved') {
      const [statuses] = await conn.execute<any[]>(
        'SELECT status FROM applications WHERE userId = ? FOR UPDATE',
        [userId],
      );
      if (statuses.some((row) => row.status === 'blacklisted')) {
        await conn.rollback();
        return null;
      }
    }
    const [rows] = await conn.execute<any[]>(
      `SELECT username, number, reviewMessageUrl, questionChannelId, removedRoles
       FROM applications
       WHERE guildId = ? AND userId = ? AND status = 'pending'
         ${expectedNumber !== undefined ? 'AND number = ?' : ''}
       FOR UPDATE`,
      [guildId, userId, ...(expectedNumber !== undefined ? [expectedNumber] : [])],
    );
    if (rows.length === 0) {
      await conn.rollback();
      return null;
    }
    await conn.execute(
      `UPDATE applications
       SET status = ?, reviewerId = ?, reason = ?, questionChannelId = NULL
       WHERE guildId = ? AND userId = ?`,
      [to, reviewerId, reason ?? null, guildId, userId],
    );
    await conn.commit();

    const row = rows[0];
    return {
      username: row.username,
      number: row.number ?? undefined,
      reviewMessageUrl: row.reviewMessageUrl ?? undefined,
      questionChannelId: row.questionChannelId ?? undefined,
      removedRoles: row.removedRoles ? JSON.parse(row.removedRoles) : undefined,
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function markApplicationLeft(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(schema.applications)
    .set({ status: 'left' })
    .where(
      and(
        eq(schema.applications.guildId, guildId),
        eq(schema.applications.userId, userId),
        eq(schema.applications.status, 'pending'),
      ),
    );

  const affectedRows = (result as any)?.[0]?.affectedRows ?? (result as any)?.affectedRows ?? 0;
  return affectedRows === 1;
}

function rowToAppeal(row: typeof schema.appeals.$inferSelect): Appeal {
  return {
    id: row.id,
    userId: row.userId,
    guildId: row.guildId,
    username: row.username,
    text: row.text,
    submittedAt: row.submittedAt,
    status: row.status as AppealStatus,
    reviewMessageUrl: row.reviewMessageUrl ?? undefined,
    reviewerId: row.reviewerId ?? undefined,
    reason: row.reason ?? undefined,
    resolvedAt: row.resolvedAt ?? undefined,
    questionChannelId: row.questionChannelId ?? undefined,
    blacklistReason: row.blacklistReason ?? undefined,
    blacklistType: row.blacklistType ?? undefined,
    number: row.number ?? undefined,
  };
}

export async function saveAppeal(appeal: AppealSubmission): Promise<void> {
  const values = {
    guildId: appeal.guildId,
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
    blacklistType: appeal.blacklistType ?? null,
    number: appeal.number ?? null,
  };

  await db
    .insert(schema.appeals)
    .values(values)
    .onDuplicateKeyUpdate({
      set: {
        username: values.username,
        text: values.text,
        submittedAt: values.submittedAt,
        status: values.status,
        reviewMessageUrl: values.reviewMessageUrl,
        reviewerId: values.reviewerId,
        reason: values.reason,
        resolvedAt: values.resolvedAt,
        questionChannelId: values.questionChannelId,
        blacklistReason: values.blacklistReason,
        blacklistType: values.blacklistType,
        number: values.number,
      },
    });
}

export async function reserveAppeal(appeal: AppealSubmission): Promise<boolean> {
  return (await reserveAppealSubmission(appeal)) !== false;
}

export async function reserveAppealSubmission(appeal: AppealSubmission): Promise<number | false> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<any[]>(
      `SELECT id, status, resolvedAt FROM appeals
       WHERE guildId = ? AND userId = ?
         AND (blacklistType = ? ${!appeal.blacklistType || appeal.blacklistType === 'ЧСП' ? 'OR blacklistType IS NULL' : ''})
       ORDER BY submittedAt DESC, id DESC FOR UPDATE`,
      [appeal.guildId, appeal.userId, appeal.blacklistType ?? 'ЧСП'],
    );
    if (
      rows.length >= APPEAL_LIMIT_PER_TYPE ||
      rows.some((row) => row.status === 'pending') ||
      (rows[0]?.status === 'denied' && rows[0].resolvedAt !== null &&
        Date.now() < Number(rows[0].resolvedAt) + APPEAL_DENY_COOLDOWN_MS)
    ) {
      await conn.rollback();
      return false;
    }
    const [result] = await conn.execute<any>(
      `INSERT INTO appeals (
        guildId, userId, username, text, submittedAt, status,
        reviewMessageUrl, reviewerId, reason, resolvedAt, questionChannelId, blacklistReason, blacklistType, number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        appeal.guildId,
        appeal.userId,
        appeal.username,
        appeal.text,
        appeal.submittedAt,
        appeal.status,
        appeal.reviewMessageUrl ?? null,
        appeal.reviewerId ?? null,
        appeal.reason ?? null,
        appeal.resolvedAt ?? null,
        appeal.questionChannelId ?? null,
        appeal.blacklistReason ?? null,
        appeal.blacklistType ?? null,
        appeal.number ?? null,
      ],
    );
    await conn.commit();
    return Number(result.insertId);
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function claimAppealQuestionChannel(
  guildId: string,
  userId: string,
  newId: string | null,
  oldId: string | null,
  appealId?: number,
): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<any[]>(
      `SELECT id FROM appeals WHERE guildId = ? AND userId = ?
       AND status = 'pending' AND questionChannelId <=> ?
       ${appealId !== undefined ? 'AND id = ?' : ''}
       LIMIT 2 FOR UPDATE`,
      [guildId, userId, oldId, ...(appealId !== undefined ? [appealId] : [])],
    );
    if (rows.length !== 1) {
      await conn.rollback();
      return false;
    }
    const [result] = await conn.execute<any>(
      "UPDATE appeals SET questionChannelId = ? WHERE guildId = ? AND id = ? AND status = 'pending' AND questionChannelId <=> ?",
      [newId, guildId, rows[0].id, oldId],
    );
    await conn.commit();
    return result.affectedRows === 1;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

export async function getAppealById(guildId: string, appealId: number): Promise<Appeal | undefined> {
  const [row] = await db
    .select()
    .from(schema.appeals)
    .where(and(eq(schema.appeals.guildId, guildId), eq(schema.appeals.id, appealId)));
  return row ? rowToAppeal(row) : undefined;
}

export async function deletePendingAppealSubmission(guildId: string, appealId: number): Promise<boolean> {
  const [result] = await pool.execute<any>(
    "DELETE FROM appeals WHERE guildId = ? AND id = ? AND status = 'pending' AND reviewMessageUrl IS NULL",
    [guildId, appealId],
  );
  return result.affectedRows === 1;
}

export async function getAppeal(
  guildId: string,
  userId: string,
): Promise<Appeal | undefined> {
  const [row] = await db
    .select()
    .from(schema.appeals)
    .where(and(eq(schema.appeals.guildId, guildId), eq(schema.appeals.userId, userId)))
    .orderBy(desc(schema.appeals.submittedAt))
    .limit(1);

  return row ? rowToAppeal(row) : undefined;
}

export async function getAppealsForUser(guildId: string, userId: string): Promise<Appeal[]> {
  const rows = await db.select().from(schema.appeals)
    .where(and(eq(schema.appeals.guildId, guildId), eq(schema.appeals.userId, userId)))
    .orderBy(desc(schema.appeals.submittedAt), desc(schema.appeals.id));
  return rows.map(rowToAppeal);
}

export async function getPendingAppeals(
  guildId: string,
  userId: string,
): Promise<Appeal[]> {
  const rows = await db
    .select()
    .from(schema.appeals)
    .where(and(eq(schema.appeals.guildId, guildId), eq(schema.appeals.userId, userId), eq(schema.appeals.status, 'pending')));

  return rows.map(rowToAppeal);
}

export async function getAppealByQuestionChannel(
  channelId: string,
): Promise<Appeal | undefined> {
  const [row] = await db
    .select()
    .from(schema.appeals)
    .where(eq(schema.appeals.questionChannelId, channelId));

  return row ? rowToAppeal(row) : undefined;
}

export async function listPendingAppeals(guildId: string): Promise<Appeal[]> {
  const rows = await db
    .select()
    .from(schema.appeals)
    .where(and(eq(schema.appeals.guildId, guildId), eq(schema.appeals.status, 'pending')))
    .orderBy(schema.appeals.submittedAt);

  return rows.map(rowToAppeal);
}

export async function listAppealQuestionChannelIds(guildId: string): Promise<string[]> {
  const rows = await db
    .select({ questionChannelId: schema.appeals.questionChannelId })
    .from(schema.appeals)
    .where(and(eq(schema.appeals.guildId, guildId), isNotNull(schema.appeals.questionChannelId)));

  return rows
    .map((row) => row.questionChannelId)
    .filter((id): id is string => Boolean(id) && !id!.startsWith('pending:'));
}

export async function updateAppeal(
  guildId: string,
  userId: string,
  patch: Partial<Appeal>,
  blacklistType?: string,
  appealId?: number,
): Promise<Appeal | undefined> {
  const [row] = await db
    .select({ id: schema.appeals.id })
    .from(schema.appeals)
    .where(and(
      eq(schema.appeals.guildId, guildId),
      eq(schema.appeals.userId, userId),
      blacklistType ? eq(schema.appeals.blacklistType, blacklistType) : undefined,
      appealId !== undefined ? eq(schema.appeals.id, appealId) : undefined,
    ))
    .orderBy(desc(schema.appeals.submittedAt), desc(schema.appeals.id))
    .limit(1);
  if (!row) return undefined;
  return updateAppealById(guildId, row.id, patch);
}

function appealPatchValues(patch: Partial<Appeal>): Partial<typeof schema.appeals.$inferInsert> {
  const values: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as Array<keyof Appeal>) {
    if (key === 'id' || key === 'guildId' || key === 'userId') continue;
    values[key] = patch[key] ?? null;
  }
  return values as Partial<typeof schema.appeals.$inferInsert>;
}

export async function setAppealReviewMessage(guildId: string, appealId: number, url: string): Promise<boolean> {
  const result = await db.update(schema.appeals).set({ reviewMessageUrl: url })
    .where(and(eq(schema.appeals.guildId, guildId), eq(schema.appeals.id, appealId), eq(schema.appeals.status, 'pending')));
  return result[0].affectedRows === 1;
}

export async function updateAppealById(
  guildId: string,
  appealId: number,
  patch: Partial<Appeal>,
): Promise<Appeal | undefined> {
  const values = appealPatchValues(patch);
  if (Object.keys(values).length > 0) {
    await db
      .update(schema.appeals)
      .set(values)
      .where(and(eq(schema.appeals.guildId, guildId), eq(schema.appeals.id, appealId)));
  }
  return getAppealById(guildId, appealId);
}

export async function rollbackAppealClaim(
  guildId: string,
  appealId: number,
  fromStatus: AppealStatus,
  patch: Partial<Appeal>,
): Promise<boolean> {
  const values = appealPatchValues(patch);
  if (Object.keys(values).length === 0) return false;
  const result = await db
    .update(schema.appeals)
    .set(values)
    .where(and(
      eq(schema.appeals.guildId, guildId),
      eq(schema.appeals.id, appealId),
      eq(schema.appeals.status, fromStatus),
    ));
  return result[0].affectedRows === 1;
}

export interface ClaimedAppeal {
  id: number;
  username: string;
  number?: number;
  reviewMessageUrl?: string;
  questionChannelId?: string;
  blacklistType?: string;
  blacklistReason?: string;
}

export async function claimAppeal(
  guildId: string,
  userId: string,
  to: AppealStatus,
  reviewerId: string,
  reason?: string,
  resolvedAt: number = Date.now(),
  blacklistType?: string,
  appealId?: number,
): Promise<ClaimedAppeal | null> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute<any[]>(
      `SELECT id, username, number, reviewMessageUrl, questionChannelId, blacklistType, blacklistReason
       FROM appeals
       WHERE guildId = ? AND userId = ? AND status = 'pending'
         ${blacklistType ? `AND (blacklistType = ? ${blacklistType === 'ЧСП' ? 'OR blacklistType IS NULL' : ''})` : ''}
         ${appealId !== undefined ? 'AND id = ?' : ''}
       ORDER BY submittedAt DESC, id DESC
       LIMIT 2
       FOR UPDATE`,
      [guildId, userId, ...(blacklistType ? [blacklistType] : []), ...(appealId !== undefined ? [appealId] : [])],
    );
    if (rows.length !== 1) {
      await conn.rollback();
      return null;
    }
    const row = rows[0];
    await conn.execute(
      `UPDATE appeals
       SET status = ?, reviewerId = ?, reason = ?, resolvedAt = ?, questionChannelId = NULL
       WHERE guildId = ? AND id = ? AND status = 'pending'`,
      [to, reviewerId, reason ?? null, resolvedAt, guildId, row.id],
    );
    await conn.commit();

    return {
      id: row.id,
      username: row.username,
      number: row.number ?? undefined,
      reviewMessageUrl: row.reviewMessageUrl ?? undefined,
      questionChannelId: row.questionChannelId ?? undefined,
      blacklistType: row.blacklistType ?? undefined,
      blacklistReason: row.blacklistReason ?? undefined,
    };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function markAppealLeft(
  guildId: string,
  userId: string,
): Promise<boolean> {
  const result = await db
    .update(schema.appeals)
    .set({ status: 'left' })
    .where(
      and(
        eq(schema.appeals.guildId, guildId),
        eq(schema.appeals.userId, userId),
        eq(schema.appeals.status, 'pending'),
      ),
    );

  const affectedRows = (result as any)?.[0]?.affectedRows ?? (result as any)?.affectedRows ?? 0;
  return affectedRows > 0;
}

export async function isUserGloballyVerified(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: schema.applications.status })
    .from(schema.applications)
    .where(and(eq(schema.applications.userId, userId), eq(schema.applications.status, 'approved')))
    .limit(1);
  return !!row;
}

export async function recordQuestionCreated(
  guildId: string,
  channelId: string,
  userId: string,
  moderatorId: string,
  kind: 'application' | 'appeal',
): Promise<void> {
  await pool.execute(
    'INSERT INTO questions (guildId, channelId, userId, moderatorId, kind, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    [guildId, channelId, userId, moderatorId, kind, Date.now()],
  );
}

export interface RecordedQuestion {
  channelId: string;
  userId: string;
  kind: 'application' | 'appeal';
  createdAt: number;
}

export async function listRecordedQuestions(guildId: string): Promise<RecordedQuestion[]> {
  const rows = await db
    .select({
      channelId: schema.questions.channelId,
      userId: schema.questions.userId,
      kind: schema.questions.kind,
      createdAt: schema.questions.createdAt,
    })
    .from(schema.questions)
    .where(eq(schema.questions.guildId, guildId));
  return rows.map((row) => ({ ...row, kind: row.kind as 'application' | 'appeal' }));
}

export async function getModeratorStats(guildId: string, moderatorId: string): Promise<ModeratorStats> {
  const [appRows] = await pool.execute<any[]>(
    `SELECT status, COUNT(*) AS cnt
     FROM applications
     WHERE guildId = ?
       AND reviewerId = ?
       AND (answers != '{}' OR status != 'approved')
       AND (reason IS NULL OR reason NOT LIKE 'Автовыдача%')
     GROUP BY status`,
    [guildId, moderatorId],
  );

  const [appealRows] = await pool.execute<any[]>(
    'SELECT status, COUNT(*) AS cnt FROM appeals WHERE guildId = ? AND reviewerId = ? GROUP BY status',
    [guildId, moderatorId],
  );

  const [questionRows] = await pool.execute<any[]>(
    'SELECT kind, COUNT(*) AS cnt FROM questions WHERE guildId = ? AND moderatorId = ? GROUP BY kind',
    [guildId, moderatorId],
  );

  const [specialRows] = await pool.execute<any[]>(
    `SELECT COUNT(*) AS cnt
     FROM special_blacklists
     WHERE guildId = ?
       AND reviewerId = ?
       AND (reason IS NULL OR reason NOT LIKE 'Автовыдача%')`,
    [guildId, moderatorId],
  );

  const appMap = new Map<string, number>();
  for (const row of appRows) {
    appMap.set(row.status, Number(row.cnt) || 0);
  }

  const approvedApps = appMap.get('approved') ?? 0;
  const rejectedApps = appMap.get('rejected') ?? 0;
  const blacklistedApps = (appMap.get('blacklisted') ?? 0) + (appMap.get('amnestied') ?? 0);
  const totalApps = approvedApps + rejectedApps + blacklistedApps;

  const appealMap = new Map<string, number>();
  for (const row of appealRows) {
    appealMap.set(row.status, Number(row.cnt) || 0);
  }

  const amnestiedAppeals = appealMap.get('amnestied') ?? 0;
  const deniedAppeals = appealMap.get('denied') ?? 0;
  const totalAppeals = amnestiedAppeals + deniedAppeals;

  const questionMap = new Map<string, number>();
  for (const row of questionRows) {
    questionMap.set(row.kind, Number(row.cnt) || 0);
  }

  const appQuestions = questionMap.get('application') ?? 0;
  const appealQuestions = questionMap.get('appeal') ?? 0;
  const totalQuestions = appQuestions + appealQuestions;

  const specialBlacklists = Number(specialRows[0]?.cnt) || 0;
  const totalActions = totalApps + totalAppeals + totalQuestions + specialBlacklists;

  return {
    moderatorId,
    applications: {
      total: totalApps,
      approved: approvedApps,
      rejected: rejectedApps,
      blacklisted: blacklistedApps,
    },
    appeals: {
      total: totalAppeals,
      amnestied: amnestiedAppeals,
      denied: deniedAppeals,
    },
    questions: {
      total: totalQuestions,
      applications: appQuestions,
      appeals: appealQuestions,
    },
    specialBlacklists,
    totalActions,
  };
}
