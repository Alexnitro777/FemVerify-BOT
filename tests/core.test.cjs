const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { Collection, GuildMemberRoleManager } = require('discord.js');
const { runUserExclusive } = require('../dist/concurrency');
const ui = require('../dist/ui');

function loadModule(name, replacements) {
  const filename = path.join(__dirname, '..', 'dist', `${name}.js`);
  const localRequire = createRequire(filename);
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  wrapper((id) => Object.hasOwn(replacements, id) ? replacements[id] : localRequire(id), module, module.exports);
  return module.exports;
}

test('user operations serialize and nested synchronization completes before the lock is released', async () => {
  const events = [];
  const first = runUserExclusive('core-lock', async () => {
    events.push('first');
    void runUserExclusive('core-lock', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push('nested');
    });
  });
  const second = runUserExclusive('core-lock', async () => { events.push('second'); });
  await Promise.all([first, second]);
  assert.deepEqual(events, ['first', 'nested', 'second']);
});

test('a caught user operation failure does not terminate Node or block subsequent operations', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const { runUserExclusive } = require('./dist/concurrency');
    runUserExclusive('failed', async () => { throw new Error('database unavailable'); })
      .catch(() => runUserExclusive('failed', async () => {}))
      .then(() => setImmediate(() => process.stdout.write('alive')));
  `], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'alive');
});

function roleFixture({ snapshot = ['restored'], specials = [], failAdd = false, position = 2 } = {}) {
  const calls = [];
  const roleCache = new Collection([
    ['guild', { id: 'guild', position: 0, managed: false }],
    ['blacklist', { id: 'blacklist', position: 1, managed: false }],
    ['restored', { id: 'restored', position, managed: false }],
    ['z', { id: 'z', position: 1, managed: false }],
    ['a', { id: 'a', position: 1, managed: false }],
    ['staff', { id: 'staff', position: 3, managed: false }],
  ]);
  const gc = { roles: { verified: 'verified', blacklist: 'blacklist', blacklistZ: 'z', blacklistA: 'a', staff: ['staff'], ststaff: [] } };
  const guild = {
    id: 'guild', roles: { cache: roleCache, everyone: roleCache.get('guild'), resolveId: (role) => typeof role === 'string' ? role : role.id },
    members: { me: { roles: { highest: { position: 100 } } } },
  };
  const client = { rest: {
    async delete(route) { calls.push(['delete', route]); },
    async put(route) { calls.push(['put', route]); if (failAdd) throw new Error('Missing Permissions'); },
  } };
  const member = {
    id: 'user', guild, client, _roles: ['blacklist'],
    _clone() { return { ...this, _roles: [...this._roles] }; },
    async edit(payload) { calls.push(['patch', payload]); return member; },
  };
  member.roles = new GuildMemberRoleManager(member);
  const storage = {
    async getApplication() { return { status: 'amnestied', removedRoles: snapshot }; },
    async getSpecialBlacklistsForUser() { return specials; },
    async clearApplicationRemovedRoles(g, u, expected) { calls.push(['clear', expected]); return true; },
  };
  return { calls, member, gc, roles: loadModule('roles', { './storage': storage }) };
}

test('lifting CHSP restores roles through singular PUT without reintroducing stale cached blacklist', async () => {
  const { calls, member, gc, roles } = roleFixture();
  assert.equal(await roles.liftProjectBlacklist(member, gc), true);
  assert.deepEqual(calls.map(([action]) => action), ['delete', 'put', 'clear']);
  assert(calls[1][1].endsWith('/restored'));
  assert.equal(member.roles.cache.has('blacklist'), true);
});

test('failed role restoration retains the snapshot', async (context) => {
  context.mock.method(console, 'error', () => {});
  const { calls, member, gc, roles } = roleFixture({ failAdd: true });
  assert.equal(await roles.liftProjectBlacklist(member, gc), false);
  assert.equal(calls.some(([action]) => action === 'clear'), false);
});

test('a role above the bot keeps the snapshot available for retry', async () => {
  const { calls, member, gc, roles } = roleFixture({ position: 101 });
  assert.equal(await roles.liftProjectBlacklist(member, gc), false);
  assert.equal(calls.some(([action]) => action === 'clear'), false);
});

test('restoration excludes cancelled special blacklists and staff roles blocked by CHSA', async () => {
  const { calls, member, gc, roles } = roleFixture({ snapshot: ['z', 'staff', 'restored'], specials: [{ type: 'ЧСА' }] });
  assert.equal(await roles.liftProjectBlacklist(member, gc), true);
  const additions = calls.filter(([action]) => action === 'put').map(([, route]) => route.split('/').at(-1));
  assert.deepEqual(additions, ['restored']);
});

test('appeal cards include the complete accepted 2000 character text', () => {
  const user = { id: 'user', createdTimestamp: 1_700_000_000_000, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
  const text = 'a'.repeat(1990) + 'FINAL_TEXT';
  const fields = ui.buildAppealEmbed(user, text).toJSON().fields.filter((field) => field.name.startsWith('Текст апелляции'));
  assert.equal(fields.map((field) => field.value).join(''), text);
  assert(fields.every((field) => field.value.length <= 1024));
});

test('review components carry the exact application generation or appeal ID', () => {
  const app = ui.buildReviewButtons('123', undefined, 7).toJSON();
  assert(app.components.every((component) => component.custom_id.endsWith(':123:7')));
  const appeal = ui.buildAppealReviewButtons('123', undefined, 'ЧСЗ', 19).toJSON();
  assert(appeal.components.every((component) => component.custom_id.endsWith(':123_ЧСЗ:19')));
});

test('splitting appeal text preserves emoji on field boundaries', () => {
  const user = { id: 'user', createdTimestamp: 1_700_000_000_000, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
  const text = 'a'.repeat(999) + '😀' + 'b'.repeat(999);
  const fields = ui.buildAppealEmbed(user, text).toJSON().fields.filter((field) => field.name.startsWith('Текст апелляции'));
  assert.equal(fields.map((field) => field.value).join(''), text);
  assert(fields.every((field) => field.value.isWellFormed() && field.value.length <= 1024));
});

function syncFixture({ applications = [], appeals = [], memberPresent = true } = {}) {
  const calls = [];
  const gc = { roles: { verified: 'verified', blacklist: 'blacklist' }, channels: {} };
  const member = {
    id: 'user', user: { tag: 'user' },
    roles: {
      cache: new Collection(),
      async add(id) { calls.push(['add', id]); },
      async remove(id) { calls.push(['remove', id]); },
    },
  };
  const guild = { id: 'secondary', members: { async fetch() { if (memberPresent) return member; throw { code: 10007 }; } } };
  const client = { user: { id: 'bot' }, guilds: { cache: new Collection([['secondary', guild]]) } };
  const storage = {
    async getApplication(guildId) { return applications.find((app) => app.guildId === guildId); },
    async getUserGlobalStatus() { return { blacklisted: applications.some((app) => app.status === 'blacklisted') }; },
    async getPendingAppeals(guildId) { return appeals.filter((appeal) => appeal.guildId === guildId && appeal.status === 'pending'); },
    async amnestyApplication(guildId) {
      const app = applications.find((entry) => entry.guildId === guildId && entry.status === 'blacklisted');
      if (app) app.status = 'amnestied';
      return Boolean(app);
    },
    async clearApplicationRemovedRoles(g, u, expected) { calls.push(['clear', expected]); return true; },
    async claimAppeal(g, u, status, reviewer, reason, at, type, id) {
      const appeal = appeals.find((entry) => entry.id === id && entry.status === 'pending' && (entry.blacklistType ?? 'ЧСП') === type);
      if (!appeal) return null;
      appeal.status = status;
      return appeal;
    },
    async claimApplication(g, u, status, reviewer, reason, number) {
      calls.push(['claim', number]);
      const app = applications.find((entry) => entry.guildId === g && entry.status === 'pending' && entry.number === number);
      if (!app) return null;
      app.status = status;
      return app;
    },
    async upsertBlacklistedApplication() { calls.push(['blacklist']); },
  };
  const module = loadModule('sync', {
    './storage': storage,
    './guildConfig': { async getGuildConfig() { return gc; } },
    './roles': {
      async restoreMemberRoles() { calls.push(['restore']); return true; },
      async blacklistMemberRoles() { return { ok: true, removed: [] }; },
    },
    './ui': { async postDecisionMessage() { calls.push(['log']); }, async markReviewMessageResolved() {} },
    './channels': { async deleteQuestionChannel() { return true; } },
  });
  return { client, module, calls };
}

test('global CHSP removal preserves approved applications and pending special appeals', async () => {
  const applications = [{ guildId: 'secondary', status: 'approved' }];
  const appeals = [
    { guildId: 'secondary', id: 1, blacklistType: 'ЧСА', status: 'pending' },
    { guildId: 'secondary', id: 2, blacklistType: 'ЧСП', status: 'pending' },
  ];
  const { client, module } = syncFixture({ applications, appeals });
  await module.removeGlobalBlacklist(client, 'user', 'origin');
  assert.equal(applications[0].status, 'approved');
  assert.equal(appeals[0].status, 'pending');
  assert.equal(appeals[1].status, 'amnestied');
});

test('global amnesty keeps absent members role snapshots', async () => {
  const applications = [{ guildId: 'secondary', status: 'blacklisted', removedRoles: ['saved'] }];
  const { client, module, calls } = syncFixture({ applications, memberPresent: false });
  await module.removeGlobalBlacklist(client, 'user', 'origin');
  assert.equal(applications[0].status, 'amnestied');
  assert.deepEqual(applications[0].removedRoles, ['saved']);
  assert.equal(calls.some(([action]) => action === 'clear'), false);
});

test('global verification performs no role edits when any guild has CHSP', async () => {
  const { client, module, calls } = syncFixture({ applications: [{ guildId: 'origin', status: 'blacklisted' }] });
  await module.applyGlobalVerification(client, 'user', 'origin');
  assert.deepEqual(calls, []);
});

test('global verification claims the exact pending application after role delivery', async () => {
  const applications = [{ guildId: 'secondary', status: 'pending', number: 5 }];
  const { client, module, calls } = syncFixture({ applications });
  await module.applyGlobalVerification(client, 'user', 'origin');
  assert.equal(applications[0].status, 'approved');
  assert.deepEqual(calls.slice(0, 2), [['add', 'verified'], ['claim', 5]]);
});

test('a returning amnestied member receives the saved roles before the snapshot is cleared', async () => {
  const calls = [];
  const handlers = new Map();
  const client = { user: { id: 'bot' }, on(event, handler) { handlers.set(event, handler); } };
  const gc = { roles: { blacklist: 'blacklist', verified: 'verified' }, channels: {} };
  const module = loadModule('memberJoin', {
    './guildConfig': { async getGuildConfig() { return gc; } },
    './storage': {
      async getUserGlobalStatus() { return { blacklisted: false, verified: false, joinedBefore: true }; },
      async getSpecialBlacklistsForUser() { return []; },
      async getApplication() { return { status: 'amnestied', removedRoles: ['saved'] }; },
      async clearApplicationRemovedRoles() { calls.push('clear'); return true; },
    },
    './roles': { async restoreMemberRoles(member, config, roles) { assert.deepEqual(roles, ['saved']); calls.push('restore'); return true; } },
    './roleTag': { hasServerTag() { return false; } },
    './inviteTracker': { async resolveJoinMethod() {} },
    './welcomeDM': { async sendWelcomeDM() {} },
    './ui': { async postDecisionMessage() {} },
  });
  module.registerMemberJoin(client);
  const member = {
    id: 'returning', client, user: { bot: false }, guild: { id: 'guild' },
    roles: { cache: new Collection(), async remove() { calls.push('remove'); } },
  };
  handlers.get('guildMemberAdd')(member);
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['remove', 'restore', 'clear']);
});
