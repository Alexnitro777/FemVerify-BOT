const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const { MySqlDialect } = require('drizzle-orm/mysql-core');
const { getTableName } = require('drizzle-orm');

function fixture({ applications = [], appeals = [], questions = [], onRead } = {}) {
  const state = { applications, appeals, questions };
  const writes = [];
  const dialect = new MySqlDialect();
  const copy = (value) => structuredClone(value);

  function matchesWhere(row, expression) {
    if (!expression) return true;
    const query = dialect.sqlToQuery(expression);
    let parameter = 0;
    for (const match of query.sql.matchAll(/`[^`]+`\.`([^`]+)`\s*(=\s*\?|is null)/gi)) {
      if (match[2].toLowerCase() === 'is null') {
        if (row[match[1]] != null) return false;
      } else if (row[match[1]] !== query.params[parameter++]) {
        return false;
      }
    }
    return true;
  }

  const db = {
    select(projection) {
      let table;
      let condition;
      let limit;
      const query = {
        from(value) { table = getTableName(value); return query; },
        where(value) { condition = value; return query; },
        orderBy() { return query; },
        limit(value) { limit = value; return query; },
        then(resolve, reject) {
          let rows = state[table].filter((row) => matchesWhere(row, condition)).map(copy);
          if (limit !== undefined) rows = rows.slice(0, limit);
          if (projection) rows = rows.map((row) => Object.fromEntries(Object.entries(projection).map(([key, column]) => [key, row[column.name]])));
          onRead?.(state);
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return query;
    },
    update(table) {
      return {
        set(values) {
          return {
            async where(condition) {
              const rows = state[getTableName(table)].filter((row) => matchesWhere(row, condition));
              writes.push({ table: getTableName(table), values: copy(values) });
              rows.forEach((row) => Object.assign(row, copy(values)));
              return [{ affectedRows: rows.length }];
            },
          };
        },
      };
    },
    insert(table) {
      return {
        values(values) {
          return {
            async onDuplicateKeyUpdate({ set }) {
              const rows = state[getTableName(table)];
              const row = rows.find((item) => item.guildId === values.guildId && item.userId === values.userId);
              if (row) Object.assign(row, copy(set));
              else rows.push(copy(values));
            },
          };
        },
      };
    },
  };

  function conditions(sql, params, start = 0) {
    let parameter = start;
    return [...sql.matchAll(/\b(\w+)\s*(<=>|=)\s*(\?|'[^']*'|NULL)/gi)].map((match) => {
      const expected = match[3] === '?' ? params[parameter++] : match[3].toUpperCase() === 'NULL' ? null : match[3].slice(1, -1);
      return (row) => (row[match[1]] ?? null) === (expected ?? null);
    });
  }

  async function execute(sql, params = []) {
    sql = sql.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT') && sql.includes('FROM applications')) {
      if (!sql.includes('guildId = ?')) return [copy(state.applications.filter((row) => row.userId === params[0]))];
      return [copy(state.applications.filter((row) => row.guildId === params[0] && row.userId === params[1] && (!sql.includes("status = 'pending'") || row.status === 'pending') && (!sql.includes('number = ?') || row.number === params[2])))];
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM appeals')) {
      let rows = state.appeals.filter((row) => row.guildId === params[0] && row.userId === params[1]);
      if (sql.includes("status = 'pending'")) rows = rows.filter((row) => row.status === 'pending');
      let parameter = 2;
      if (sql.includes('questionChannelId <=> ?')) rows = rows.filter((row) => (row.questionChannelId ?? null) === params[parameter]);
      if (sql.includes('questionChannelId <=> ?')) parameter += 1;
      if (sql.includes('blacklistType = ?')) {
        const type = params[parameter++];
        rows = rows.filter((row) => row.blacklistType === type || (sql.includes('OR blacklistType IS NULL') && row.blacklistType == null));
      }
      if (sql.includes('AND id = ?')) rows = rows.filter((row) => row.id === params[parameter]);
      rows = rows.toSorted((a, b) => b.submittedAt - a.submittedAt || b.id - a.id);
      if (sql.includes('LIMIT 2')) rows = rows.slice(0, 2);
      return [copy(rows)];
    }
    const update = sql.match(/^UPDATE (\w+) SET (.+) WHERE (.+)$/i);
    if (update) {
      const values = {};
      let parameter = 0;
      for (const match of update[2].matchAll(/\b(\w+)\s*=\s*(\?|'[^']*'|NULL)/gi)) {
        values[match[1]] = match[2] === '?' ? params[parameter++] : match[2].toUpperCase() === 'NULL' ? null : match[2].slice(1, -1);
      }
      const predicates = conditions(update[3], params, parameter);
      const rows = state[update[1]].filter((row) => predicates.every((predicate) => predicate(row)));
      writes.push({ table: update[1], values: copy(values) });
      rows.forEach((row) => Object.assign(row, copy(values)));
      return [{ affectedRows: rows.length }];
    }
    if (sql.startsWith('INSERT INTO appeals')) {
      const id = Math.max(0, ...state.appeals.map((row) => row.id)) + 1;
      const keys = ['guildId', 'userId', 'username', 'text', 'submittedAt', 'status', 'reviewMessageUrl', 'reviewerId', 'reason', 'resolvedAt', 'questionChannelId', 'blacklistReason', 'blacklistType', 'number'];
      state.appeals.push({ id, ...Object.fromEntries(keys.map((key, i) => [key, params[i]])) });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO applications')) {
      if (sql.includes("'blacklisted'")) {
        const [guildId, userId, username, submittedAt, reason, reviewerId, removedRoles] = params;
        const row = state.applications.find((entry) => entry.guildId === guildId && entry.userId === userId);
        const values = { username, submittedAt, reason, reviewerId, removedRoles, status: 'blacklisted', questionChannelId: null };
        if (row) Object.assign(row, values);
        else state.applications.push({ guildId, userId, answers: '{}', ...values });
        return [{ affectedRows: 1 }];
      }
      const keys = ['guildId', 'userId', 'username', 'answers', 'submittedAt', 'status', 'reviewMessageUrl', 'reviewerId', 'reason', 'questionChannelId', 'number', 'joinMethod', 'removedRoles'];
      const values = Object.fromEntries(keys.map((key, i) => [key, params[i]]));
      const existing = state.applications.find((row) => row.guildId === values.guildId && row.userId === values.userId);
      if (existing) Object.assign(existing, values);
      else state.applications.push(values);
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  const conn = { execute, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  const pool = { execute, getConnection: async () => conn };
  const filename = path.join(__dirname, '..', 'dist', 'storage.js');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module,
    exports: module.exports,
    require: (name) => name === './db' ? { db, pool } : nativeRequire(name),
    console,
    Date,
  }, { filename });
  return { storage: module.exports, state, writes };
}

const app = (patch = {}) => ({ guildId: 'guild', userId: 'user', username: 'user', answers: '{}', submittedAt: 1, status: 'pending', number: 2, removedRoles: null, ...patch });
const appeal = (patch = {}) => ({ id: 1, guildId: 'guild', userId: 'user', username: 'user', text: 'appeal', submittedAt: 1, status: 'pending', blacklistType: 'ЧСП', questionChannelId: null, ...patch });
const submission = (patch = {}) => ({ guildId: 'guild', userId: 'user', username: 'user', text: 'appeal', submittedAt: Date.now(), status: 'pending', blacklistType: 'ЧСП', ...patch });

test('application patch cannot overwrite a concurrent moderator decision', async () => {
  const f = fixture({ applications: [app()], onRead(state) { state.applications[0].status = 'approved'; state.applications[0].reviewerId = 'moderator'; } });
  await f.storage.updateApplication('guild', 'user', { questionChannelId: undefined });
  assert.equal(f.state.applications[0].status, 'approved');
  assert.equal(f.state.applications[0].reviewerId, 'moderator');
  assert.deepEqual(f.writes[0].values, { questionChannelId: null });
});

test('appeal update uses its exact ID and changes only requested fields', async () => {
  const f = fixture({ appeals: [appeal(), appeal({ id: 2, submittedAt: 2, questionChannelId: 'second' })] });
  await f.storage.updateAppealById('guild', 1, { questionChannelId: undefined });
  assert.equal(f.state.appeals[0].status, 'pending');
  assert.equal(f.state.appeals[1].questionChannelId, 'second');
  assert.deepEqual(f.writes[0].values, { questionChannelId: null });
});

test('confirming an appeal review URL does not require a fallible read after the write', async () => {
  const f = fixture({ appeals: [appeal()], onRead() { throw new Error('connection lost after write'); } });
  assert.equal(await f.storage.setAppealReviewMessage('guild', 1, 'review-url'), true);
  assert.equal(f.state.appeals[0].reviewMessageUrl, 'review-url');
});

test('amnesty preserves restoration data and leaves approved applications unchanged', async () => {
  const f = fixture({ applications: [app({ status: 'approved', removedRoles: '["role"]' }), app({ guildId: 'other', status: 'blacklisted', removedRoles: '["other-role"]' })] });
  assert.equal(await f.storage.amnestyApplication('guild', 'user'), false);
  assert.equal(await f.storage.amnestyApplication('other', 'user'), true);
  assert.equal(f.state.applications[0].status, 'approved');
  assert.equal(f.state.applications[1].status, 'amnestied');
  assert.equal(f.state.applications[1].removedRoles, '["other-role"]');
});

test('clearing a role snapshot requires the expected data and amnestied status', async () => {
  const f = fixture({ applications: [app({ status: 'amnestied', removedRoles: '["new-role"]' })] });
  assert.equal(await f.storage.clearApplicationRemovedRoles('guild', 'user', ['old-role']), false);
  assert.equal(f.state.applications[0].removedRoles, '["new-role"]');
  assert.equal(await f.storage.clearApplicationRemovedRoles('guild', 'user', ['new-role']), true);
  assert.equal(f.state.applications[0].removedRoles, null);
});

test('verification reservation cannot replace a global blacklist', async () => {
  const f = fixture({ applications: [app({ guildId: 'other', status: 'blacklisted' })] });
  assert.equal(await f.storage.reserveApplication({ ...app(), answers: {} }), false);
  assert.equal(f.state.applications.length, 1);
  assert.equal(f.state.applications[0].status, 'blacklisted');
});

test('verification reservation preserves an already approved local application', async () => {
  const f = fixture({ applications: [app({ status: 'approved' })] });
  assert.equal(await f.storage.reserveApplication({ ...app(), answers: {} }), false);
  assert.equal(f.state.applications[0].status, 'approved');
});

test('verification cannot erase a role snapshot awaiting restoration after amnesty', async () => {
  const f = fixture({ applications: [app({ status: 'amnestied', removedRoles: '["saved-role"]' })] });
  assert.equal(await f.storage.reserveApplication({ ...app(), answers: {} }), false);
  assert.equal(f.state.applications[0].status, 'amnestied');
  assert.equal(f.state.applications[0].removedRoles, '["saved-role"]');
});

test('a repeated blacklist merges the saved snapshot instead of discarding unrestored roles', async () => {
  const f = fixture({ applications: [app({ status: 'amnestied', removedRoles: '["old-role"]' })] });
  await f.storage.upsertBlacklistedApplication({
    guildId: 'guild', userId: 'user', username: 'user', reason: 'new reason', reviewerId: 'moderator', removedRoles: ['new-role'],
  });
  assert.deepEqual(JSON.parse(f.state.applications[0].removedRoles), ['old-role', 'new-role']);
  assert.equal(f.state.applications[0].status, 'blacklisted');
});

test('a stale application number cannot claim a newer application or its question', async () => {
  const f = fixture({ applications: [app()] });
  assert.equal(await f.storage.claimApplication('guild', 'user', 'rejected', 'moderator', undefined, 1), null);
  assert.equal(await f.storage.claimApplicationQuestionChannel('guild', 'user', 'question', null, 1), false);
  assert.equal(f.state.applications[0].status, 'pending');
  assert.equal(f.state.applications[0].questionChannelId, undefined);
});

test('approval cannot claim an application while another guild has a blacklist', async () => {
  const f = fixture({ applications: [app(), app({ guildId: 'other', status: 'blacklisted' })] });
  assert.equal(await f.storage.claimApplication('guild', 'user', 'approved', 'moderator', undefined, 2), null);
  assert.equal(f.state.applications[0].status, 'pending');
});

test('question reservation updates only the requested pending appeal despite history', async () => {
  const f = fixture({ appeals: [appeal({ status: 'denied' }), appeal({ id: 2, submittedAt: 2 })] });
  assert.equal(await f.storage.claimAppealQuestionChannel('guild', 'user', 'question', null, 2), true);
  assert.equal(f.state.appeals[0].questionChannelId, null);
  assert.equal(f.state.appeals[1].questionChannelId, 'question');
});

test('legacy question reservation fails safely for multiple pending appeals', async () => {
  const f = fixture({ appeals: [appeal(), appeal({ id: 2, submittedAt: 2, blacklistType: 'ЧСА' })] });
  assert.equal(await f.storage.claimAppealQuestionChannel('guild', 'user', 'question', null), false);
  assert(f.state.appeals.every((row) => row.questionChannelId === null));
});

test('closed applications and appeals cannot reserve question channels', async () => {
  const f = fixture({ applications: [app({ status: 'approved' })], appeals: [appeal({ status: 'amnestied' })] });
  assert.equal(await f.storage.claimApplicationQuestionChannel('guild', 'user', 'question', null, 2), false);
  assert.equal(await f.storage.claimAppealQuestionChannel('guild', 'user', 'question', null, 1), false);
});

test('appeal reservation enforces the two-per-type history limit', async () => {
  const f = fixture({ appeals: [appeal({ status: 'left' }), appeal({ id: 2, submittedAt: 2, status: 'amnestied' })] });
  assert.equal(await f.storage.reserveAppealSubmission(submission()), false);
  assert.equal(f.state.appeals.length, 2);
});

test('appeal reservation applies the same seven-day denial cooldown', async () => {
  const f = fixture({ appeals: [appeal({ status: 'denied', resolvedAt: Date.now() - 3 * 86400000 })] });
  assert.equal(await f.storage.reserveAppealSubmission(submission()), false);
  f.state.appeals[0].resolvedAt = Date.now() - 8 * 86400000;
  assert.equal(await f.storage.reserveAppealSubmission(submission()), 2);
});

test('appeal limit does not mix legacy project blacklist history with special lists', async () => {
  const f = fixture({ appeals: [appeal({ status: 'denied', blacklistType: null, resolvedAt: Date.now() })] });
  assert.equal(await f.storage.reserveAppealSubmission(submission({ blacklistType: 'ЧСА' })), 2);
});

test('an appeal decision targets the exact ID without claiming another type', async () => {
  const f = fixture({ appeals: [appeal(), appeal({ id: 2, submittedAt: 2, blacklistType: 'ЧСА' })] });
  const claimed = await f.storage.claimAppeal('guild', 'user', 'amnestied', 'moderator', undefined, Date.now(), 'ЧСП', 1);
  assert.equal(claimed.id, 1);
  assert.equal(f.state.appeals[0].status, 'amnestied');
  assert.equal(f.state.appeals[1].status, 'pending');
});

test('legacy appeal decisions refuse ambiguous pending records', async () => {
  const f = fixture({ appeals: [appeal(), appeal({ id: 2, submittedAt: 2, blacklistType: 'ЧСА' })] });
  assert.equal(await f.storage.claimAppeal('guild', 'user', 'amnestied', 'moderator'), null);
  assert(f.state.appeals.every((row) => row.status === 'pending'));
});

test('rollback cannot overwrite a newer application state', async () => {
  const f = fixture({ applications: [app({ status: 'blacklisted' })] });
  assert.equal(await f.storage.rollbackApplicationClaim('guild', 'user', 'approved', 2, { status: 'pending' }), false);
  assert.equal(f.state.applications[0].status, 'blacklisted');
});

test('rollback cannot change another application with the same status', async () => {
  const f = fixture({ applications: [app({ status: 'approved', number: 3 })] });
  assert.equal(await f.storage.rollbackApplicationClaim('guild', 'user', 'approved', 2, { status: 'pending' }), false);
  assert.equal(f.state.applications[0].number, 3);
  assert.equal(f.state.applications[0].status, 'approved');
});

test('appeal rollback is scoped by ID and claimed status', async () => {
  const f = fixture({ appeals: [appeal({ status: 'denied' }), appeal({ id: 2, status: 'amnestied' })] });
  assert.equal(await f.storage.rollbackAppealClaim('guild', 1, 'amnestied', { status: 'pending' }), false);
  assert.equal(await f.storage.rollbackAppealClaim('guild', 2, 'amnestied', { status: 'pending' }), true);
  assert.equal(f.state.appeals[0].status, 'denied');
  assert.equal(f.state.appeals[1].status, 'pending');
});

test('snapshot cleanup cannot clear data belonging to a new blacklist', async () => {
  const f = fixture({ applications: [app({ status: 'blacklisted', removedRoles: '["restored-later"]' })] });
  assert.equal(await f.storage.clearApplicationRemovedRoles('guild', 'user', ['restored-later']), false);
  assert.equal(f.state.applications[0].removedRoles, '["restored-later"]');
});

test('recorded question listing retains provenance and excludes other guilds', async () => {
  const f = fixture({ questions: [{ guildId: 'guild', channelId: 'own', userId: 'user', kind: 'application', createdAt: 1 }, { guildId: 'other', channelId: 'foreign', userId: 'user', kind: 'appeal', createdAt: 2 }] });
  const rows = await f.storage.listRecordedQuestions('guild');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].channelId, 'own');
  assert.equal(rows[0].kind, 'application');
});
