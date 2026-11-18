const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const test = require('node:test');
const { Collection, Events } = require('discord.js');

const dist = path.resolve(__dirname, '../dist');
const quiet = { log() {}, warn() {}, error() {} };
const immediateLock = async (_userId, task) => task();

function loadModule(name, mocks = {}, globals = {}) {
  const filename = path.join(dist, `${name}.js`);
  const source = fs.readFileSync(filename, 'utf8');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : nativeRequire(name),
    __filename: filename,
    __dirname: path.dirname(filename),
    console: quiet,
    Buffer,
    process,
    setTimeout,
    clearTimeout,
    setInterval: () => ({ unref() {} }),
    ...globals,
  };
  vm.runInNewContext(source, context, { filename });
  return module.exports;
}

function concurrency() {
  return {
    runUserExclusive: immediateLock,
    logSettledFailures() {},
    mapWithConcurrency: async (items, _limit, task) => Promise.allSettled(items.map(task)),
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

test('trap channel mutex handles a rejected operation and permits a retry', async () => {
  let calls = 0;
  const trap = loadModule('trapChannel', {
    './storage': { getTrapKicksCount: async () => { calls += 1; throw new Error('database unavailable'); } },
    './guildConfig': {},
    './roles': {},
    './sync': {},
    './ui': {},
    './channels': {},
    './config': {},
    './permissions': {},
    './concurrency': concurrency(),
  });
  const channel = { isTextBased: () => true, messages: {} };
  const client = { channels: { cache: new Collection([['channel', channel]]) } };
  await assert.rejects(trap.ensureTrapChannelMessage(client, 'guild', 'channel'), /database unavailable/);
  await flush();
  await assert.rejects(trap.ensureTrapChannelMessage(client, 'guild', 'channel'), /database unavailable/);
  await flush();
  assert.equal(calls, 2);
});

test('server tag updates distinguish an omitted primary guild from explicit removal', async () => {
  let raw;
  let removed = 0;
  const guild = {
    id: 'guild',
    members: {
      cache: new Collection([['user', { roles: { cache: new Collection([['tag', {}]]) } }]]),
      removeRole: async () => { removed += 1; },
    },
  };
  const tags = loadModule('roleTag', {
    './guildConfig': { getGuildConfig: async () => ({ roles: { roleTag: 'tag' }, channels: {} }) },
    './concurrency': concurrency(),
  });
  tags.registerTagRoleEvents({
    on: (_event, handler) => { raw = handler; },
    guilds: { cache: new Collection([['guild', guild]]) },
  });
  raw({ t: 'GUILD_MEMBER_UPDATE', d: { guild_id: 'guild', user: { id: 'user' }, roles: ['tag'] } });
  await flush();
  assert.equal(removed, 0);
  raw({ t: 'GUILD_MEMBER_UPDATE', d: { guild_id: 'guild', user: { id: 'user', primary_guild: null }, roles: ['tag'] } });
  await flush();
  assert.equal(removed, 1);
});

async function runCleanup({ records = [], applications = [], appeals = [], refs = {}, deleteOk = true }) {
  const deleted = [];
  const restored = [];
  const channels = new Collection();
  for (const id of ['rules', ...records.map((record) => record.channelId), ...applications, ...appeals]) {
    channels.set(id, { id, name: id, parentId: 'category', createdTimestamp: Date.now() - 3 * 86400000 });
  }
  const guild = { id: 'guild', channels: { fetch: async (id) => id ? channels.get(id) : channels } };
  const cleanup = loadModule('questionCleanup', {
    './storage': {
      listApplicationQuestionChannelIds: async () => applications,
      listAppealQuestionChannelIds: async () => appeals,
      listRecordedQuestions: async () => records,
      getApplicationByQuestionChannel: async (id) => refs[id]?.kind === 'application' ? refs[id] : undefined,
      getAppealByQuestionChannel: async (id) => refs[id]?.kind === 'appeal' ? refs[id] : undefined,
    },
    './channels': { deleteQuestionChannel: async (_guild, id) => { deleted.push(id); return deleteOk; } },
    './questionRestore': { restoreReviewButton: async (_client, id) => { restored.push(id); } },
    './concurrency': concurrency(),
  });
  let ready;
  cleanup.registerQuestionCleanup({
    once: (_event, handler) => { ready = handler; },
    guilds: { cache: new Collection([['guild', guild]]) },
  });
  ready();
  await flush();
  return { deleted, restored };
}

test('question cleanup deletes only recorded bot channels and keeps unrelated category channels', async () => {
  const result = await runCleanup({ records: [{ channelId: 'orphan', userId: 'user', kind: 'application', createdAt: 1 }] });
  assert.deepEqual(result.deleted, ['orphan']);
  assert.deepEqual(result.restored, ['orphan']);
});

test('failed question deletion keeps its database reference and review controls intact', async () => {
  const result = await runCleanup({
    applications: ['question'],
    refs: { question: { kind: 'application', userId: 'user', status: 'pending' } },
    deleteOk: false,
  });
  assert.deepEqual(result.deleted, ['question']);
  assert.deepEqual(result.restored, []);
});

test('active appeal questions do not expire but finished appeal questions are retried', async () => {
  const result = await runCleanup({
    appeals: ['active', 'finished'],
    refs: {
      active: { kind: 'appeal', userId: 'active-user', status: 'pending' },
      finished: { kind: 'appeal', userId: 'finished-user', status: 'amnestied' },
    },
  });
  assert.deepEqual(result.deleted, ['finished']);
});

test('restoring appeal question controls uses the original appeal id and blacklist type', async () => {
  const appeal = { id: 17, guildId: '123', userId: 'user', blacklistType: 'ЧСЗ', status: 'pending', reviewMessageUrl: 'https://discord.com/channels/123/456/789' };
  const updates = [];
  const buttons = [];
  const edited = [];
  const restore = loadModule('questionRestore', {
    './storage': {
      getApplicationByQuestionChannel: async () => undefined,
      getAppealByQuestionChannel: async () => appeal,
      updateAppealById: async (...args) => { updates.push(args); return { ...appeal, questionChannelId: undefined }; },
    },
    './ui': { buildAppealReviewButtons: (...args) => { buttons.push(args); return { id: 17 }; } },
    './concurrency': concurrency(),
  });
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => ({ edit: async (payload) => { edited.push(payload); } }) } }) } };
  await restore.restoreReviewButton(client, 'question');
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1], 17);
  assert.deepEqual(buttons[0], ['user', undefined, 'ЧСЗ', 17]);
  assert.equal(edited.length, 1);
});

test('member leave closes every pending appeal and retains a failed channel deletion for retry', async () => {
  const appeals = [
    { id: 1, blacklistType: 'ЧСЗ', questionChannelId: 'question-1' },
    { id: 2, blacklistType: 'ЧСА', questionChannelId: 'question-2' },
  ];
  const claimedIds = [];
  const deleted = [];
  const retained = [];
  const cleanup = loadModule('leaveCleanup', {
    './storage': {
      getApplication: async () => undefined,
      getPendingAppeals: async () => appeals,
      claimAppeal: async (...args) => {
        claimedIds.push(args[7]);
        return { ...appeals.find((appeal) => appeal.id === args[7]) };
      },
      updateAppealById: async (...args) => { retained.push(args); },
    },
    './ui': {},
    './channels': { deleteQuestionChannel: async (_guild, id) => { deleted.push(id); return id !== 'question-2'; } },
    './concurrency': concurrency(),
  });
  let leave;
  cleanup.registerLeaveCleanupEvents({ on: (event, handler) => { assert.equal(event, Events.GuildMemberRemove); leave = handler; } });
  leave({ id: 'user', guild: { id: 'guild', client: { user: { id: 'bot' } } } });
  await flush();
  assert.deepEqual(claimedIds, [1, 2]);
  assert.deepEqual(deleted, ['question-1', 'question-2']);
  assert.equal(retained.length, 1);
  assert.equal(retained[0][1], 2);
  assert.equal(retained[0][2].questionChannelId, 'question-2');
});

function archiveHarness({ archiveOk = true, pageFailure = false, messages = 0, configured = true } = {}) {
  let fetches = 0;
  let deleted = 0;
  const archived = [];
  const channel = {
    name: 'вопрос-user',
    id: 'question',
    isTextBased: () => true,
    messages: {
      fetch: async () => {
        const offset = fetches++ * 100;
        if (pageFailure && offset >= 100) throw new Error('history fetch unavailable');
        const remaining = Math.max(0, Math.min(100, messages - offset));
        return new Collection(Array.from({ length: remaining }, (_, index) => {
          const id = String(messages - offset - index);
          return [id, { id, author: { bot: false }, createdTimestamp: Number(id) }];
        }));
      },
    },
    delete: async () => { deleted += 1; },
  };
  const channels = loadModule('channels', {
    './guildConfig': { getGuildConfig: async () => ({ channels: configured ? { questionLog: 'logs' } : {} }) },
    './storage': {},
    './ui': {
      formatQuestionTranscript: (messages) => String(messages.length),
      postQuestionLogMessage: async (...args) => { archived.push(args); return archiveOk; },
    },
  });
  const guild = { client: {}, channels: { fetch: async () => channel } };
  return {
    run: () => channels.deleteQuestionChannel(guild, 'question', { targetUserId: 'user', kind: 'application' }),
    getState: () => ({ fetches, deleted, archived }),
  };
}

test('question archiving reads all pages beyond 500 messages before deleting the source', async () => {
  const harness = archiveHarness({ messages: 650 });
  assert.equal(await harness.run(), true);
  const state = harness.getState();
  assert.equal(state.fetches, 7);
  assert.equal(state.archived[0][3], '650');
  assert.equal(state.deleted, 1);
});

test('failed transcript delivery keeps the only source channel', async () => {
  const harness = archiveHarness({ messages: 10, archiveOk: false });
  assert.equal(await harness.run(), false);
  assert.equal(harness.getState().deleted, 0);
});

test('failed history pagination does not send a partial transcript or delete the source', async () => {
  const harness = archiveHarness({ messages: 250, pageFailure: true });
  assert.equal(await harness.run(), false);
  assert.equal(harness.getState().archived.length, 0);
  assert.equal(harness.getState().deleted, 0);
});

test('question deletion works when optional archiving is not configured', async () => {
  const harness = archiveHarness({ configured: false });
  assert.equal(await harness.run(), true);
  assert.equal(harness.getState().fetches, 0);
  assert.equal(harness.getState().deleted, 1);
});

test('vanity joins are detected even without any ordinary invites', async () => {
  let vanityCalls = 0;
  const guild = {
    id: 'guild',
    name: 'test guild',
    features: ['VANITY_URL'],
    members: { me: { permissions: { has: () => true } } },
    invites: { fetch: async () => new Collection() },
    fetchVanityData: async () => ({ code: 'vanity', uses: vanityCalls++ }),
  };
  const tracker = loadModule('inviteTracker', {
    './storage': {},
    './concurrency': concurrency(),
  });
  let ready;
  tracker.registerInviteTracker({
    once: (_event, handler) => { ready = handler; },
    on() {},
    guilds: { cache: new Collection([['guild', guild]]) },
  });
  await ready();
  assert.equal(await tracker.detectJoinMethodLocked(guild), 'https://discord.gg/vanity');
  assert.equal(vanityCalls, 2);
});
