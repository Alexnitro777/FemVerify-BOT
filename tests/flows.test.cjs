const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const test = require('node:test');
const { Collection, MessageFlags, PermissionFlagsBits } = require('discord.js');

const concurrency = {
  runUserExclusive: async (_userId, operation) => operation(),
  logSettledFailures() {},
};
const config = { isMainGuild: () => true, getMainGuildInvite: () => undefined };
const gc = {
  guildId: '200',
  roles: { verified: 'verified', blacklist: 'chsp', blacklistZ: 'chsz', blacklistA: 'chsa', staff: ['staff'], ststaff: ['ststaff'] },
  channels: { review: 'review', appealReview: 'appeals' },
  questionCategoryId: 'category',
};
const ui = {
  buildDmEmbed: () => ({}),
  postDecisionMessage: async () => {},
  markReviewMessageResolved: async () => {},
};

function load(name, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../dist', `${name}.js`);
  const module = { exports: {} };
  const nativeRequire = createRequire(filename);
  const defaults = { '../config': config, '../concurrency': concurrency };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    exports: module.exports,
    module,
    require: (request) => Object.hasOwn(mocks, request) ? mocks[request]
      : Object.hasOwn(defaults, request) ? defaults[request] : nativeRequire(request),
    console: { log() {}, error() {}, warn() {} },
    Buffer,
    setTimeout,
    clearTimeout,
    ...globals,
  }, { filename });
  return module.exports.default ?? module.exports;
}

function interaction(customId, roles = ['staff']) {
  const replies = [];
  return {
    customId,
    guildId: '200',
    id: '999',
    user: { id: '300', tag: 'moderator', createdTimestamp: 1, displayAvatarURL: () => 'https://example.com/avatar.png' },
    client: { user: { id: '400' } },
    member: { roles: { cache: new Collection(roles.map((role) => [role, {}])) } },
    inGuild: () => true,
    fields: { getTextInputValue: () => 'A clear reason for the moderation decision' },
    message: { url: 'https://discord.com/channels/200/500/600', flags: { has: () => true } },
    replies,
    reply: async (payload) => { replies.push(payload); },
    editReply: async (payload) => { replies.push(payload); },
    followUp: async (payload) => { replies.push(payload); },
    update: async (payload) => { replies.push(payload); },
    deferReply: async () => {},
    deferUpdate: async () => {},
    showModal: async (modal) => { replies.push({ modal }); },
  };
}

for (const [name, customId] of [
  ['reviewReason', 'review:reason:reject:100:1'],
  ['chspReason', 'chsp:reason:100'],
  ['unchspReason', 'unchsp:reason:100'],
  ['specialBlacklistReason', 'special_bl:add:ЧСА:100'],
]) {
  test(`${name} rejects modal submission after staff access was revoked`, async () => {
    const i = interaction(customId, []);
    const handler = load(`modals/${name}`, {
      '../storage': new Proxy({}, { get() { throw new Error('Database must not be accessed'); } }),
      '../ui': ui,
      '../roles': {},
      '../sync': {},
      '../channels': {},
    });
    await handler.execute(i, gc);
    assert.equal(i.replies[0].content, 'Недостаточно прав.');
  });
}

test('application reason form carries the original number into its atomic claim', async () => {
  let expected;
  const i = interaction('review:reason:reject:100:1');
  i.guild = { members: { cache: new Collection(), fetch: async () => null } };
  const handler = load('modals/reviewReason', {
    '../storage': {
      claimApplication: async (...args) => { expected = args[5]; return null; },
      getApplication: async () => ({ number: 2, status: 'pending' }),
    },
    '../ui': ui, '../roles': {}, '../sync': {}, '../channels': {},
  });
  await handler.execute(i, gc);
  assert.equal(expected, 1);
  assert.match(i.replies.at(-1).content, /уже обработана/);
});

test('legacy reason forms without an application identity cannot claim a newer application', async () => {
  const i = interaction('review:reason:reject:100');
  const handler = load('modals/reviewReason', {
    '../storage': {}, '../ui': ui, '../roles': {}, '../sync': {}, '../channels': {},
  });
  await handler.execute(i, gc);
  assert.match(i.replies[0].content, /устарела/);
});

test('review blacklist propagates the committed decision to other guilds', async () => {
  let propagated = 0;
  const i = interaction('review:reason:blacklist:100:2');
  i.guild = { members: { cache: new Collection(), fetch: async () => null } };
  const handler = load('modals/reviewReason', {
    '../storage': { claimApplication: async () => ({ number: 2 }) },
    '../ui': ui,
    '../roles': {},
    '../sync': { applyGlobalBlacklist: async (_client, userId, _reason, _reviewer, guildId) => {
      assert.equal(userId, '100'); assert.equal(guildId, '200'); propagated += 1;
    } },
    '../channels': { deleteQuestionChannel: async () => true },
  });
  await handler.execute(i, gc);
  assert.equal(propagated, 1);
});

test('database blacklist prevents opening verification without its Discord role', async () => {
  const i = interaction('verify:start', []);
  const handler = load('buttons/verifyStart', {
    '../storage': { getUserGlobalStatus: async () => ({ blacklisted: true, verified: false }) },
    '../ui': ui,
  });
  await handler.execute(i, gc);
  assert.match(i.replies[0].content, /чёрном списке/);
  assert.equal(i.replies.some((reply) => reply.modal), false);
});

test('automatic verification reports role assignment failure without successful audit log', async () => {
  const i = interaction('verify:start', []);
  i.member.roles.add = async () => { throw new Error('Missing Permissions'); };
  let successfulLogs = 0;
  const handler = load('buttons/verifyStart', {
    '../storage': { getUserGlobalStatus: async () => ({ blacklisted: false, verified: true }), getApplication: async () => undefined },
    '../ui': { ...ui, postDecisionMessage: async () => { successfulLogs += 1; } },
  });
  await handler.execute(i, gc);
  assert.match(i.replies.at(-1).content, /Не удалось выдать роль/);
  assert.equal(successfulLogs, 0);
});

test('automatic age blacklist propagates to other guilds', async () => {
  const i = interaction('verify:submit', []);
  i.fields.getTextInputValue = (field) => field === 'age' ? '12' : 'A sufficiently detailed application answer';
  i.guild = { members: { fetch: async () => ({ roles: { cache: new Collection() }, send: async () => {} }) } };
  let propagated = 0;
  let stored;
  const handler = load('modals/verifySubmit', {
    '../storage': {
      getApplication: async () => undefined,
      getUserGlobalStatus: async () => ({ blacklisted: false }),
      nextApplicationNumber: async () => 1,
      getJoinMethod: async () => 'invite',
      saveApplication: async (application) => { stored = application; },
    },
    '../ui': ui,
    '../roles': { blacklistMemberRoles: async () => ({ ok: true, removed: ['old'] }) },
    '../sync': { applyGlobalBlacklist: async () => { propagated += 1; } },
  });
  await handler.execute(i, gc);
  assert.equal(stored.status, 'blacklisted');
  assert.equal(propagated, 1);
});

test('appeal start enforces the common seven day cooldown', async () => {
  const i = interaction('appeal:start', ['chsp']);
  const handler = load('buttons/appealStart', {
    '../storage': { getAppealsForUser: async () => [{ id: 1, blacklistType: 'ЧСП', status: 'denied', submittedAt: 1, resolvedAt: Date.now() - 3 * 86400000 }] },
  });
  await handler.execute(i, gc);
  assert.match(i.replies.at(-1).content, /Новую можно подать/);
  assert.equal(i.replies.some((reply) => reply.modal), false);
});

test('saved appeal selector checks the submission limit again', async () => {
  const i = interaction('appeal:select_type:ЧСЗ', ['chsz']);
  const handler = load('buttons/appealSelectType', {
    '../storage': { getAppealsForUser: async () => [
      { id: 1, blacklistType: 'ЧСЗ', status: 'left', submittedAt: 1 },
      { id: 2, blacklistType: 'ЧСЗ', status: 'amnestied', submittedAt: 2 },
    ] },
  });
  await handler.execute(i, gc);
  assert.match(i.replies.at(-1).content, /лимит/);
  assert.equal(i.replies.some((reply) => reply.modal), false);
});

test('appeal submission rejects a selected blacklist that was removed', async () => {
  const i = interaction('appeal:submit:ЧСЗ', ['chsa']);
  i.fields.getTextInputValue = () => 'a'.repeat(80);
  i.guild = { members: { fetch: async () => i.member } };
  const handler = load('modals/appealSubmit', { '../storage': {}, '../ui': ui });
  await handler.execute(i, gc);
  assert.match(i.replies.at(-1).content, /больше недоступен/);
});

test('appeal is reserved before posting and review controls contain its exact id', async () => {
  const i = interaction('appeal:submit:ЧСЗ', ['chsz']);
  i.fields.getTextInputValue = () => 'a'.repeat(80);
  i.guild = { members: { fetch: async () => i.member } };
  const events = [];
  let idInButtons;
  i.client.channels = { fetch: async () => ({ isTextBased: () => true, send: async () => {
    events.push('send'); return { url: 'message-url' };
  } }) };
  const handler = load('modals/appealSubmit', {
    '../storage': {
      getAppealsForUser: async () => [], getSpecialBlacklist: async () => ({ reason: 'dating reason' }),
      nextAppealNumber: async () => 5,
      reserveAppealSubmission: async () => { events.push('reserve'); return 23; },
      setAppealReviewMessage: async (_guild, id, url) => {
        assert.equal(id, 23); assert.equal(url, 'message-url'); events.push('update'); return true;
      },
    },
    '../ui': { buildAppealEmbed: () => ({}), buildAppealReviewButtons: (_user, _url, _type, id) => { idInButtons = id; return {}; } },
  });
  await handler.execute(i, gc);
  assert.deepEqual(events, ['reserve', 'send', 'update']);
  assert.equal(idInButtons, 23);
});

test('failed appeal delivery releases only its own unposted reservation', async () => {
  const i = interaction('appeal:submit:ЧСЗ', ['chsz']);
  i.fields.getTextInputValue = () => 'a'.repeat(80);
  i.guild = { members: { fetch: async () => i.member } };
  let deleted;
  i.client.channels = { fetch: async () => ({ isTextBased: () => true, send: async () => { throw new Error('Missing Access'); } }) };
  const handler = load('modals/appealSubmit', {
    '../storage': {
      getAppealsForUser: async () => [], getSpecialBlacklist: async () => undefined,
      nextAppealNumber: async () => 6, reserveAppealSubmission: async () => 24,
      deletePendingAppealSubmission: async (_guild, id) => { deleted = id; },
    },
    '../ui': { buildAppealEmbed: () => ({}), buildAppealReviewButtons: () => ({}) },
  });
  await handler.execute(i, gc);
  assert.equal(deleted, 24);
  assert.match(i.replies.at(-1).content, /Не удалось отправить/);
});

test('uncertain review URL persistence preserves the delivered appeal card and its reservation', async () => {
  const i = interaction('appeal:submit:ЧСЗ', ['chsz']);
  i.fields.getTextInputValue = () => 'a'.repeat(80);
  i.guild = { members: { fetch: async () => i.member } };
  let deleted = false;
  i.client.channels = { fetch: async () => ({ isTextBased: () => true, send: async () => ({
    url: 'message-url', delete: async () => { deleted = true; },
  }) }) };
  const handler = load('modals/appealSubmit', {
    '../storage': {
      getAppealsForUser: async () => [], getSpecialBlacklist: async () => undefined,
      nextAppealNumber: async () => 6, reserveAppealSubmission: async () => 24,
      setAppealReviewMessage: async () => { throw new Error('connection lost after write'); },
      deletePendingAppealSubmission: async () => { deleted = true; },
    },
    '../ui': { buildAppealEmbed: () => ({}), buildAppealReviewButtons: () => ({}) },
  });
  await handler.execute(i, gc);
  assert.equal(deleted, false);
  assert.match(i.replies.at(-1).content, /размещена/);
});

test('amnestying a dating blacklist leaves the project application untouched', async () => {
  const i = interaction('appeal:confirm_amnesty:100_ЧСЗ:23', ['ststaff']);
  let removedSpecial;
  let projectChanges = 0;
  const member = { roles: { remove: async (role) => { assert.equal(role, 'chsz'); } }, send: async () => {} };
  i.guild = { members: { cache: new Collection([['100', member]]) } };
  const handler = load('buttons/appealReview', {
    '../storage': {
      getAppealById: async () => ({ id: 23, userId: '100', status: 'pending', blacklistType: 'ЧСЗ' }),
      claimAppeal: async (...args) => { assert.equal(args[7], 23); return { id: 23, blacklistType: 'ЧСЗ' }; },
      amnestyApplication: async () => { projectChanges += 1; },
      removeSpecialBlacklist: async (_guild, _user, type) => { removedSpecial = type; },
    },
    '../ui': ui,
    '../roles': { liftProjectBlacklist: async () => { projectChanges += 1; } },
    '../channels': { deleteQuestionChannel: async () => true },
    '../sync': {},
  });
  await handler.execute(i, gc);
  assert.equal(removedSpecial, 'ЧСЗ');
  assert.equal(projectChanges, 0);
});

test('new application question grants access to the bot and retains its application number', async () => {
  const i = interaction('review:question:100:8');
  i.message.url = 'https://discord.com/channels/200/500/600';
  let overwrites;
  let encodedNumber;
  const applicant = { user: { username: 'applicant' } };
  i.guild = {
    id: '200', roles: { everyone: { id: '200' } },
    members: { cache: new Collection([['100', applicant]]) },
    channels: { create: async (options) => {
      overwrites = options.permissionOverwrites;
      return { id: '700', url: 'https://discord.com/channels/200/700', send: async () => {} };
    } },
  };
  const handler = load('buttons/review', {
    '../storage': {
      getApplication: async () => ({ number: 8, status: 'pending', reviewMessageUrl: 'https://discord.com/channels/200/500/600' }),
      claimApplicationQuestionChannel: async (...args) => { assert.equal(args[4], 8); return true; },
      recordQuestionCreated: async () => {},
    },
    '../ui': { buildReviewButtons: (_user, _url, number) => { encodedNumber = number; return {}; } },
    '../sync': {}, '../channels': {},
  });
  await handler.execute(i, gc);
  const bot = overwrites.find((entry) => entry.id === '400');
  assert(bot.allow.includes(PermissionFlagsBits.ViewChannel));
  assert(bot.allow.includes(PermissionFlagsBits.ReadMessageHistory));
  assert.equal(encodedNumber, 8);
});

test('unblacklist commands allow removing records when the Discord role is missing', async () => {
  const i = interaction('');
  const guild = { id: '200', ownerId: 'owner', roles: { cache: new Collection() } };
  const target = { id: '100', guild, roles: { cache: new Collection(), highest: { position: 1 } } };
  const moderator = { id: '300', guild, roles: { cache: new Collection(), highest: { position: 10, comparePositionTo: () => 1 } } };
  guild.members = { cache: new Collection([['100', target], ['300', moderator]]) };
  i.guild = guild;
  i.options = { getUser: () => ({ id: '100' }) };
  const command = load('commands/unchsp', { '../storage': { getApplication: async () => ({ status: 'blacklisted' }) } });
  await command.execute(i, gc);
  assert(i.replies.at(-1).modal);
  i.replies.length = 0;
  const factory = load('specialBlacklistHelper', { './storage': { getSpecialBlacklist: async () => ({ type: 'ЧСЗ' }) } });
  await factory.buildSpecialBlacklistCommand('ЧСЗ', 'remove').execute(i, gc);
  assert(i.replies.at(-1).modal);
});

test('role import closes the exact pending application and its question', async () => {
  const i = interaction('');
  i.user.id = '703129488170549258';
  i.options = { getString: (name) => name === 'категория' ? 'chsp' : 'Import reason' };
  const member = { id: '100', user: { bot: false, tag: 'applicant' }, roles: { cache: new Collection([['chsp', {}]]) } };
  i.guild = { id: '200', members: { fetch: async () => new Collection([['100', member]]) } };
  let claimed;
  let closedChannel;
  let closedMessage;
  let imported = 0;
  const command = load('commands/import_roles', {
    '../storage': {
      getApplication: async () => ({ status: 'pending', number: 8 }),
      claimApplication: async (...args) => {
        claimed = args;
        return { number: 8, questionChannelId: 'question', reviewMessageUrl: 'original-review' };
      },
      upsertBlacklistedApplication: async () => { imported += 1; },
    },
    '../ui': {
      ...ui,
      markReviewMessageResolved: async (_client, url) => { closedMessage = url; },
    },
    '../channels': { deleteQuestionChannel: async (_guild, channelId) => { closedChannel = channelId; return true; } },
  }, { setTimeout: (resolve) => resolve() });
  await command.execute(i, gc);
  assert.equal(claimed[2], 'blacklisted');
  assert.equal(claimed[5], 8);
  assert.equal(closedChannel, 'question');
  assert.equal(closedMessage, 'original-review');
  assert.equal(imported, 1);
});

test('verified role import preserves an outstanding role restoration snapshot', async () => {
  const i = interaction('');
  i.user.id = '703129488170549258';
  i.options = { getString: (name) => name === 'категория' ? 'verified' : 'Import reason' };
  const member = { id: '100', user: { bot: false, tag: 'applicant' }, roles: { cache: new Collection([['verified', {}]]) } };
  i.guild = { id: '200', members: { fetch: async () => new Collection([['100', member]]) } };
  let imported = false;
  const command = load('commands/import_roles', {
    '../storage': {
      getApplication: async () => ({ status: 'amnestied', removedRoles: ['saved-role'] }),
      upsertVerifiedApplication: async () => { imported = true; },
    },
    '../ui': ui,
    '../channels': {},
  }, { setTimeout: (resolve) => resolve() });
  await command.execute(i, gc);
  assert.equal(imported, false);
});
