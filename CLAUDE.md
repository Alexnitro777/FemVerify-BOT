# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rule: no comments

**Never write comments in any file.** This applies to all source, config, and build files (`.ts`, `.json`, `Dockerfile`, etc.). The only file allowed to contain comments is `docker-compose.example.yml` — it documents the environment variables for humans and its comments must be preserved. Do not add comments anywhere else, and remove any comments you encounter elsewhere. Write self-explanatory code (clear names, small functions) instead of explaining it in prose.

## Docs convention

`README.md`, `CLAUDE.md`, and `docs/` document **only** the Docker workflow (the bot container plus an external MySQL/MariaDB the container connects to). Local development works (the `package.json` scripts — `build`/`start`/`dev` — are real and need only Node ≥ 24 and a reachable MySQL) but must not be documented in these files, and must never be described as unsupported. Frame all DB details as how the Docker image connects to MariaDB.

## What this is

FemVerify-BOT — a Discord verification bot (discord.js v14, TypeScript). Members submit application forms; moderators approve/reject/blacklist; rejected/blacklisted users can appeal ("amnesty"). It also auto-grants a role based on the Discord **Server Tag** and protects servers with honeypot trap channels. The UI is in Russian and slash-command names are Cyrillic (`/верификация`, `/апелляция`, `/анкеты`, `/амнистии`, `/тег`, `/выдатьчсп`, `/снятьчсп`, `/выдатьчсз`, `/снятьчсз`, `/выдатьчса`, `/снятьчса`, `/админстат`, `/внести`, `/синхронизировать`).

The bot is **multi-guild**: one process serves every server it's in, and each guild's roles/channels/category are configured independently (rows in the `guild_settings` table, not a config file). There are **no config files on disk**: the database connection comes from `DB_*` environment variables, and global identity (`token`, `clientId`) lives in the `app_config` table. Access is restricted by `ALLOWED_GUILD_IDS` — a hardcoded whitelist in `index.ts`; the bot auto-leaves any guild not in the set on startup and on `guildCreate`.

The deepest behavioral reference is `docs/verification-and-appeals.md` (every verification/appeal scenario) and `docs/features.md`. Read those before changing decision flows.

## Commands

Build, run, and deploy via Docker Compose:

```bash
docker compose up -d --build
docker compose logs -f
docker compose restart
docker compose down
```

- `docker compose up -d --build` builds the image (multi-stage, `node:24-slim`) and starts the bot. The image `CMD` is just `node dist/index.js`; the bot **registers its own slash commands** on `clientReady` (and on `guildCreate`) for every guild it's in (`commandRegistration.ts`) — there is no separate registration entrypoint.
- **Rebuild** with `up -d --build` after any code change. After changing environment variables, recreate the container with `docker compose up -d --force-recreate`. Use `docker compose restart` to reread database configuration. Stored `app_config` values take precedence over environment variables. Slash-command changes register automatically the next time the bot starts. Registration is guild-scoped (`commandRegistration.ts` → `applicationGuildCommands(clientId, guildId)` per guild).
- **Configure a guild** by inserting its settings into the `guild_settings` table (SQL/GUI) — see Configuration. After changing a guild's rows, `docker compose restart` to drop the per-guild config cache.
- Regression tests use the built-in Node.js test runner in `tests/`; no linter is configured.
- Only `docker-compose.yml` is gitignored — copy from `docker-compose.example.yml`. There are **no config files**; all state and configuration live in an **external MySQL/MariaDB** reached via `DB_*` env vars (no on-disk DB file or `data/` volume).

## Configuration

There are **no configuration files** — everything lives in env vars or the database:

- **Database connection** (`db.ts`) — read **only** from env: `DB_HOST`, `DB_PORT` (default 3306), `DB_USER`, `DB_PASSWORD` (default empty), `DB_NAME`, `DB_CONNECTION_LIMIT` (default 10). Missing `DB_HOST`/`DB_USER`/`DB_NAME` throws at startup. Creates a `mysql2` pool (utf8mb4, `supportBigNumbers`, `enableKeepAlive`) **and** a `drizzle-orm` instance wrapping the same pool — the codebase uses **both** raw SQL (for DDL/migrations in `initStorage`) and Drizzle ORM queries (for DML in `storage.ts`). Schema declarations live in `schema.ts`.
- **Bot identity & global settings** (`config.ts`) — `token`, `clientId`, and optional `mainGuildId`, `mainGuildInvite` from the `app_config` table (keys `token`, `clientId`, `mainGuildId`, `mainGuildInvite`). `initAppConfig()` (called in `index.ts` after `initStorage()`) reads them via `getAppConfigValue`; if a value is absent it falls back to `BOT_TOKEN`/`CLIENT_ID`/`MAIN_GUILD_ID`/`MAIN_GUILD_INVITE` env and **persists it** via `setAppConfigValue` (set the env once on first run, or `INSERT` directly). Missing `token`/`clientId` → throw. `mainGuildId` restricts `/апелляция`, `/амнистии`, and the appeal submission flow to the primary guild.
- **Guild whitelist** — `ALLOWED_GUILD_IDS` in `index.ts` is a hardcoded `Set` of Discord guild IDs the bot is allowed to stay on. On `clientReady` the bot iterates `guilds.cache` and calls `guild.leave()` on any guild not in the set; `guildCreate` does the same immediately. Add a new guild's ID here and rebuild.
- **Per-guild config** — rows in the `guild_settings` table (keyed `(guildId, key)`), entered **directly via SQL/GUI** (no file, no seeder). Dotted keys: `roles.verified`, `roles.blacklist`, `roles.blacklistZ`, `roles.blacklistA`, `roles.staff`, `roles.ststaff`, `roles.roleTag`, `channels.review`, `channels.appealReview`, `channels.welcome|decisions|appeal|tagLog|blacklistLog|questionLog|trap`, `questionCategoryId`. `roles.staff`/`roles.ststaff` and `channels.trap` are comma-separated lists. The third tier, **owner**, is **not** in the DB — it's a hardcoded `OWNER_IDS` array in `permissions.ts`.

At runtime `guildConfig.ts` reads a guild's settings out of `guild_settings`, validates required keys, builds a `GuildConfig`, and **caches it per guild** (`invalidateGuildConfig(guildId)` clears one entry; the bot invalidates on `guildCreate`, so after editing a guild's rows `docker compose restart`). `warmGuildConfigs(guildIds)` pre-fetches configs for all allowed guilds on boot. `interactionCreate.ts` resolves the `GuildConfig` for `interaction.guildId` and passes it to every command/button/modal as `execute(interaction, gc)`; a guild with no/invalid settings yields "⚠️ Бот не настроен на этом сервере."

Required per guild: `roles.verified`, `roles.blacklist`, `roles.staff`, `roles.ststaff`, `channels.review`, `questionCategoryId`. Optional: `channels.appealReview` (used on the main server for appeals), `roles.blacklistZ`, `roles.blacklistA`, `roles.roleTag`, `channels.welcome|decisions|appeal|tagLog|blacklistLog|questionLog|trap`.

Privileged **GuildMembers** and **MessageContent** intents must be enabled in the Discord Developer Portal, and the bot needs **Manage Server** for invite-based "join method" detection.

## Architecture

### Handler autoloading + routing
`handlers/loader.ts` scans `src/commands`, `src/buttons`, `src/modals` at startup and registers each module's `default` export into a `Collection` on the client. To add a feature you just drop a new file that default-exports the right shape (see `types.ts`): `SlashCommand` = `{ data, access?, execute }`; `ButtonHandler`/`ModalHandler` = `{ customId, execute }`. No central registry to edit.

`handlers/interactionCreate.ts` is the single router. For every guild interaction it first resolves that guild's `GuildConfig` (replying "не настроен" when there is none), then passes `gc` into the handler — **every handler's `execute` takes `(interaction, gc)`**. Slash commands dispatch by `commandName` and are gated by `hasCommandAccess(interaction, gc, …)` (default access is the strictest, `'owner'`). Buttons and modals go through one shared `runComponent()` and a `HandlerRegistry` (`handlers/registry.ts`) that indexes literal customIds in a `Map` and scans `RegExp` ones in order — exact match first, then **first pattern wins**, so keep RegExp customIds mutually exclusive. An unmatched customId gets an ephemeral "кнопка устарела" reply instead of silence, and every interaction is timed: the router logs `[slow] <id>: lag=…ms, handler=…ms` when gateway lag exceeds 300 ms or the handler exceeds 500 ms.

### customId convention
Components encode state in the customId as `namespace:action[:targetId]`, e.g. `review:approve:<userId>`, `appeal:deny:<userId>`, `question:close:<channelId>`. Handlers with a dynamic target use a `RegExp` customId and `split(':')` out the action + id. The reason-collection flow chains: a `review:reject`/`blacklist` button opens a modal whose customId is `review:reason:<action>:<userId>`, handled by `modals/reviewReason.ts`. The `/выдатьчсп` slash command chains the same way — `commands/chsp.ts` opens a modal `chsp:reason:<userId>` (handled by `modals/chspReason.ts`) that collects the reason and then applies the blacklist. Its mirror `/снятьчсп` (`commands/unchsp.ts`) opens a modal `unchsp:reason:<userId>` (handled by `modals/unchspReason.ts`) that collects the reason and then lifts the blacklist (removes the ЧС role + restores `removedRoles`). The ЧСЗ/ЧСА commands use a shared pattern: `commands/chsz.ts`/`chsa.ts`/`unchsz.ts`/`unchsa.ts` are one-liners calling `buildSpecialBlacklistCommand(type, action)` from `specialBlacklistHelper.ts`, which opens a modal with customId `special_bl:<action>:<type>:<userId>` (handled by `modals/specialBlacklistReason.ts`). The handler must split the target `userId` out of its own customId; the slash command itself does nothing but show the modal.

### Three blacklist types
The bot manages three independent blacklist tiers, each with its own role and add/remove commands:

| Tier | Role key | Add command | Remove command | Table | Scope |
|---|---|---|---|---|---|
| **ЧСП** (project) | `roles.blacklist` | `/выдатьчсп` | `/снятьчсп` | `applications` (`status = 'blacklisted'`) | **Global** — propagates to all guilds via `sync.ts` |
| **ЧСЗ** (dating) | `roles.blacklistZ` | `/выдатьчсз` | `/снятьчсз` | `special_blacklists` (`type = 'ЧСЗ'`) | **Per-guild** |
| **ЧСА** (admin) | `roles.blacklistA` | `/выдатьчса` | `/снятьчса` | `special_blacklists` (`type = 'ЧСА'`) | **Per-guild**, also strips `roles.staff`+`roles.ststaff` |

ЧСП is the main blacklist (strips all roles, blocks verification, only escape is appeal). ЧСЗ/ЧСА are "special" blacklists stored in the separate `special_blacklists` table via `upsertSpecialBlacklist`/`removeSpecialBlacklist` — they add/remove a single role and don't touch `applications`. All six commands require `ststaff` access and enforce `canManageByHierarchy` — the moderator's highest role must be above the target's.

### Global sync (`sync.ts`)
Three functions propagate decisions to every guild the bot is in (excluding the originating guild):
- `applyGlobalBlacklist(client, userId, reason, reviewerId, excludeGuildId?)` — strips roles + sets ЧСП + closes pending applications/appeals on each guild.
- `removeGlobalBlacklist(client, userId, excludeGuildId?)` — restores roles + removes ЧСП role + amnests pending appeals.
- `applyGlobalVerification(client, userId, excludeGuildId?)` — adds `roles.verified` + auto-approves pending applications.

Called by `buttons/review.ts` (approve → `applyGlobalVerification`, blacklist → `applyGlobalBlacklist`), `modals/chspReason.ts` (→ `applyGlobalBlacklist`), `modals/unchspReason.ts` (→ `removeGlobalBlacklist`), `buttons/appealReview.ts` (amnesty → `removeGlobalBlacklist`), and `trapChannel.ts` (→ `applyGlobalBlacklist`). Guild iteration is throttled via `mapWithConcurrency(guilds, 5, …)`.

### Blacklist protection (`chsaProtection.ts`)
`registerChsaProtection(client)` subscribes to `GuildMemberUpdate` and enforces three rules on every role change:
1. If a member has a `special_blacklists` row for ЧСА and their ЧСА role was manually removed in Discord → **auto-restores** the role and **strips** any `roles.staff`/`roles.ststaff` they gained.
2. If a member has a row for ЧСЗ and their ЧСЗ role was removed → auto-restores.
3. If a member has `applications.status = 'blacklisted'` and their ЧСП role was removed → auto-restores.

This prevents moderators or admins from bypassing blacklists by removing roles in Discord directly.

### Applications and appeal history
There are two domains: **applications** (verification) and **appeals** (amnesty). Applications use a composite `(guildId, userId)` primary key and a per-guild application number as their generation. Appeals preserve history under an auto-increment `id`, with one pending appeal per blacklist type and a lifetime limit of two submissions per type. A denial requires a seven-day wait before the second submission. Pass the exact appeal ID or application generation through components and conditional status transitions. Status state machines live in `types.ts`.

**Use conditional status transitions.**
`claimApplication` requires pending status and accepts the expected application number; `claimAppeal` accepts the exact appeal ID and type. Both return pre-claim UI/channel data or null when the expected record cannot be claimed. Use `rollbackApplicationClaim` or `rollbackAppealClaim` for conditional rollbacks after a failed Discord operation. Patch helpers update only supplied fields. Do not replace an entire row to update one field.

Verification reservations reject global CHSP and pending/approved local records, and preserve outstanding restoration snapshots. `reserveAppealSubmission` enforces the shared policy from `appealPolicy.ts`, inserts before Discord delivery, and returns the new ID. A failed send releases only its unposted pending reservation. Delivered appeal cards survive uncertain URL persistence and can repair their exact link on moderator interaction.

Question reservations require pending status and the exact application generation or appeal ID. A `pending:<interactionId>` placeholder is exchanged for the real channel ID after creation. Question channels carry a topic marker, explicit bot permissions, and a tracking record for safe cleanup and archive retries.

Direct CHSP uses `upsertBlacklistedApplication`: it handles users without applications and transactionally merges removed-role snapshots. Its mirror uses `amnestyApplication` only for blacklisted records, preserves removed roles, and closes only CHSP appeals. Special blacklists never amnesty verification applications. Mutations for one user are serialized with `runUserExclusive`, including global propagation.

### Role stripping & restore (the `removedRoles` round-trip)
`roles.ts` is the only place that bulk-strips and restores a member's roles. `blacklistMemberRoles(member, gc)` removes every role positioned **below the bot's highest** (skipping `@everyone`, the blacklist role, and keeping `managed`/integration roles, special blacklist roles, **and `roles.roleTag`** — the tag role must survive, otherwise `roleTag.ts` immediately hands it back and the removal is recorded as if it were stripped), sets the member to `[…kept, roles.blacklist]`, and returns `{ ok, removed }`. The `removed` IDs are persisted to the application's **`removedRoles`** column — by `modals/reviewReason.ts` on a review-blacklist and `modals/chspReason.ts` on `/выдатьчсп`. The reverse, `restoreMemberRoles(member, gc, removedRoles)`, re-adds those IDs using singular role PUT requests that do not merge a stale role cache (skipping `roles.verified`, `managed`, roles that no longer exist in `guild.roles.cache`, and anything now at/above the bot) when a blacklist is lifted — `buttons/appealReview.ts` amnesty and `modals/unchspReason.ts` `/снятьчсп` — and clears `removedRoles` only after all eligible roles were restored; failed or absent-member restoration keeps the snapshot for retry. Roles at/above the bot are never touched, so both helpers degrade gracefully when the bot's role sits too low and report it via `ok` / the boolean return (handlers surface this as a "проверьте иерархию ролей" warning).

### Database layer: Drizzle ORM + raw SQL
`db.ts` exports both a raw `mysql2` **pool** and a `drizzle-orm` **db** instance wrapping the same pool. `schema.ts` declares all Drizzle table schemas. DDL (table creation, `addColumnIfMissing`, `addIndexIfMissing`) runs as raw SQL in `initStorage()` for maximum compatibility with existing databases. DML queries in `storage.ts` use Drizzle ORM (`db.select(…).from(…)`, `db.insert(…)`, `db.update(…)`, etc.) with the schema imports. When adding a new table: (1) add the Drizzle schema in `schema.ts`, (2) add the `CREATE TABLE IF NOT EXISTS` raw SQL in `initStorage()`, (3) add any `addColumnIfMissing`/`addIndexIfMissing` calls for migrations.

### Schema tables
| Table | Key | Purpose |
|---|---|---|
| `applications` | `(guildId, userId)` | Verification applications — one per user per guild |
| `appeals` | `id` auto (+ index on `(guildId, userId)`) | Appeal submissions |
| `counters` | `(guildId, name)` | Per-guild sequential numbering (nextApplicationNumber, nextAppealNumber) |
| `join_methods` | `(guildId, userId)` | Invite-derived join method per member |
| `guild_settings` | `(guildId, key)` | Per-guild config (read by `guildConfig.ts`) |
| `app_config` | `key` | Bot token/clientId + `commandsHash:<guildId>` per guild |
| `special_blacklists` | `(guildId, userId, type)` | ЧСЗ/ЧСА records (separate from ЧСП in `applications`) |
| `questions` | `id` auto (+ index on `(guildId, moderatorId)`) | Question channel tracking for `/админстат` stats |

### Background workers (all registered in `index.ts`)
Each worker is guild-aware: the event-driven ones (`memberJoin`, `roleTag`, `leaveCleanup`, `inviteTracker`, `voiceKick`, `trapChannel`, `chsaProtection`) take `guildId` from the gateway event; the periodic sweeps (`applicationCleanup`, `questionCleanup`) iterate `client.guilds.cache`. Workers that need roles/channels (`memberJoin`, `roleTag`, `applicationCleanup`) resolve a full `GuildConfig` via `getGuildConfig(guild.id)` and skip guilds with none; the others operate on `guildId` alone.
- `memberJoin.ts` — the single `guildMemberAdd` subscriber. One `getUserGlobalStatus(userId)` query (three `EXISTS` in one `SELECT`) yields `{ blacklisted, verified, joinedBefore }`; the wanted role set is computed with **blacklist priority** (`blacklist` XOR `verified`, plus `roles.roleTag` when the member wears the tag) and applied in a single `member.roles.add([...])`. The tail — blacklist-record upsert, decision log, invite-derived join method, first-time welcome DM — runs through `Promise.allSettled`.
- `welcomeDM.ts` — sends a welcome embed with server links to first-time members (called from `memberJoin.ts` when `!joinedBefore`). The embed content is hardcoded in the file.
- `roleTag.ts` — detects the Discord **Server Tag** (`user.primaryGuild`, read in both camelCase and snake_case) and adds/removes `roles.roleTag`. Its only subscription is the **raw `GUILD_MEMBER_UPDATE` gateway packet** — discord.js does not reliably surface tag changes, and the packet carries both `d.user.primary_guild` and `d.roles`, so the handler exits without any REST call whenever the member already has the right role (the common case for nickname/avatar edits). Role edits go through `guild.members.addRole/removeRole` without materialising a `GuildMember`; a per-member mutex (`runExclusive`) serializes them and the tag-log embed is sent outside the lock. `syncAllTagRoles` runs a full sweep on `clientReady`, skipping members whose role already matches. The join-time tag role is granted by `memberJoin.ts`, not here.
- `applicationCleanup.ts` — sweeps pending applications past a 48h TTL → `expired` (DMs user, deletes question channel, marks the review message resolved).
- `questionCleanup.ts` / `questionRestore.ts` — auto-delete **application** question channels past a 48h TTL (2 days, same as the application TTL, so an application and its question channel close together). **Appeal** question channels are deliberately exempt from the TTL sweep (`ttlDelete=false`) — they are only removed on appeal resolution or when the member leaves; the sweep still self-heals a stale DB reference (restores the "Ask a question" button) for both domains when a channel is already gone.
- `leaveCleanup.ts` — on `guildMemberRemove`, marks a pending application/appeal `left`, flips its review message to the disabled "left" row, and **deletes its question channel** (this is what removes appeal question channels, since they have no TTL).
- `inviteTracker.ts` — tracks which invite a member used (the "join method" shown on the form).
- `trapChannel.ts` — catches messages sent in `channels.trap` (trap channels / honeypots): immediately deletes the message and auto-issues global ЧСП (`Автовыдача: Взлом/Реклама`) to non-staff/non-owner members. Uses `runExclusive(userId)` mutex to serialize concurrent messages from the same user.
- `voiceKick.ts` — subscribes to `VoiceStateUpdate` and `GuildMemberUpdate`. Disconnects any member from voice if they have the `roles.blacklist` role — both when joining a voice channel with the role, and when receiving the role while already in voice.
- `chsaProtection.ts` — subscribes to `GuildMemberUpdate`. Enforces ЧСА/ЧСЗ/ЧСП role persistence: if a blacklist role was manually removed in Discord while the DB record still exists, the role is auto-restored. For ЧСА specifically, also strips any `roles.staff`/`roles.ststaff` roles the member gained.

### Rendering layer
`ui.ts` is the single source of every embed and button row — the application/appeal review cards, the moderator decision buttons (`buildReviewButtons`/`buildAppealReviewButtons` encode the `review:*`/`appeal:*` customIds), the disabled "processed/left/expired" rows, DM embeds, the welcome embed, and the mirrored summary posted via `postDecisionMessage(client, channelId, …)` (called with `gc.channels.decisions` for verification/appeal decisions, and `gc.channels.blacklistLog` for `/выдатьчсп`·`/снятьчсп`·`/выдатьчсз`·`/снятьчсз`·`/выдатьчса`·`/снятьчса` and trap auto-blocks). It also owns the two review-message helpers every decision path shares: `resolveReviewMessage(client, url, known?)` (reuses `interaction.message` instead of re-fetching when the URL matches) and `markReviewMessageResolved(client, url, { kind, label, color, reviewerId, reason?, row?, known? })`, plus `postWelcomeMessage`, which sends the ping and the welcome embed in a single message with `allowedMentions`. Application answers and decision reasons are limited per field. Appeal text is split across fields without truncation. Change UI here, not inline in handlers, so every flow stays consistent.

### Permissions
`permissions.ts` is **three-tier** and reads roles from the passed `GuildConfig`. The levels, from highest to lowest, are `owner` ⊇ `ststaff` ⊇ `staff` (ranked via the `RANK` map). `resolveAccessLevel(member, userId, gc)` is the single source of truth: it returns `owner` when `userId` is in the hardcoded `OWNER_IDS` array, else `ststaff` for a `gc.roles.ststaff` role, else `staff` for a `gc.roles.staff` role, else `null`. It is **strict** — no Discord permission (Administrator / Manage Roles / Manage Channels) grants anything; only configured roles and the owner ID do. Slash commands: `commandAccessLevel(interaction, gc)` wraps the resolver and `hasCommandAccess(interaction, gc, required)` passes when `RANK[level] >= RANK[required]`. Moderation modals recheck access with `hasModalAccess`. Buttons call `hasButtonAccess(interaction, gc, required)` themselves (review buttons require `staff`, appeal buttons require `ststaff`, `question:close` requires `staff`) since the router only auth-checks slash commands.

**Hierarchy check:** `canManageByHierarchy(moderator, target)` returns `true` if the moderator's highest role is strictly above the target's (server owner always passes, targeting the server owner always fails). Used by `/выдатьчсз`/`/снятьчсз`/`/выдатьчса`/`/снятьчса` to prevent moderators from blacklisting members whose roles are higher. `canManageRoles(moderator, roleIds)` checks if the moderator's highest role is above each given role.

Per-tier map: **staff** = `/анкеты`, `/тег`, `/админстат`, application review buttons; **ststaff** = those plus `/амнистии`, `/выдатьчсп`, `/снятьчсп`, `/выдатьчсз`, `/снятьчсз`, `/выдатьчса`, `/снятьчса`, appeal review buttons; **owner** = everything, including `/верификация`, `/апелляция`, `/внести` (usable only by an `OWNER_IDS` user, on every guild). `/синхронизировать` has `access: 'staff'` but additionally hardcodes `ALLOWED_ID` — only one specific user ID can run it. The `setDefaultMemberPermissions(...)` on each command is **only a Discord UI visibility hint** (Discord can't gate by user ID) — the real enforcement is always `hasCommandAccess`/`hasButtonAccess` in code, so changing it never changes who can actually run a command.

### Cache optimizations
`index.ts` configures `makeCache` with aggressive limits: `MessageManager: 0`, `PresenceManager: 0`, `ReactionManager: 0`, `GuildEmojiManager: 0`, `GuildStickerManager: 0`, and several others set to 0. A sweeper removes bot users (except self) from the user cache every hour. This keeps memory usage low for a multi-guild bot that never needs messages, reactions, or presences cached.

### Constraints to respect
- Discord modals allow **max 5 input fields** — `verifyQuestions` in `questions.ts` is already at the limit.
- Question channels are created under `gc.questionCategoryId` with explicit permission overwrites for the applicant + the staff roles that may review that domain: application question channels grant `staff` + `ststaff` (`[...new Set([...gc.roles.staff, ...gc.roles.ststaff])]`), appeal question channels grant `ststaff` only (so `staff` never sees appeal channels).
- `index.ts` requests intents `Guilds`, `GuildMembers`, `GuildInvites`, `GuildVoiceStates`, `GuildMessages`, `MessageContent` and partials `GuildMember`, `Message`; SIGINT/SIGTERM trigger a clean `client.destroy()` + `closeDb()` with an 8-second forced-exit timeout.
- `ALLOWED_GUILD_IDS` is a hardcoded set in `index.ts` — the bot auto-leaves any guild not in this set.
- ЧСЗ/ЧСА commands use `buildSpecialBlacklistCommand` factory in `specialBlacklistHelper.ts` — adding a new blacklist type means adding a one-liner command file and extending the `getRoleAndName` function.
