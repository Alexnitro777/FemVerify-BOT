# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rule: no comments

**Never write comments in any file.** This applies to all source, config, and build files (`.ts`, `.json`, `Dockerfile`, etc.). The only two files allowed to contain comments are `config.example.json` and `docker-compose.example.yml` — these document configuration for humans and their comments must be preserved. Do not add comments anywhere else, and remove any comments you encounter elsewhere. Write self-explanatory code (clear names, small functions) instead of explaining it in prose.

## Docs convention

`README.md`, `CLAUDE.md`, and `docs/` document **only** the Docker workflow. Local development works (Node ≥ 22.5 with `--experimental-sqlite`; the `package.json` scripts are real) but must not be documented in these files, and must never be described as unsupported. Keep `node:sqlite`/flag details framed as how the Docker image runs.

## What this is

FemVerify-BOT — a Discord verification bot (discord.js v14, TypeScript). Members submit application forms; moderators approve/reject/blacklist; rejected/blacklisted users can appeal ("amnesty"). It also auto-grants a role based on the Discord **Server Tag**. The UI is in Russian and slash-command names are Cyrillic (`/верификация`, `/апелляция`, `/анкеты`, `/амнистии`, `/тег`, `/чсп`).

The deepest behavioral reference is `docs/verification-and-appeals.md` (every verification/appeal scenario) and `docs/features.md`. Read those before changing decision flows.

## Commands

Build, run, and deploy via Docker Compose:

```bash
docker compose up -d --build
docker compose logs -f
docker compose restart
docker compose down
```

- `docker compose up -d --build` builds the image (multi-stage, `node:24-slim`) and starts the bot. The image `CMD` first registers slash commands and then launches the bot — both run as `node --experimental-sqlite dist/...` (the built-in `node:sqlite` module needs Node ≥ 22.5 and that flag; the Dockerfile already supplies both).
- **Rebuild** with `up -d --build` after any code change; **restart** with `docker compose restart` after editing `config.json`. Slash-command changes (editing `data` in `commands/*.ts`) register automatically on the next rebuild — there is no separate deploy step. Registration is guild-scoped (`deploy-commands.ts` → `applicationGuildCommands(clientId, guildId)`), so commands appear only on `config.guildId` and update instantly.
- **No test framework and no linter are configured.** Don't invent `npm test` / `npm run lint`.
- `config.json` and `docker-compose.yml` are gitignored — copy from `config.example.json` / `docker-compose.example.yml`. The SQLite DB lives at `data/bot.db` (WAL mode) and persists across rebuilds via a volume.

## Configuration

`config.ts` loads `config.json` and **validates it at import time** — missing required fields throw immediately on startup. The file is JSONC: a hand-rolled `stripJsonComments` allows `//` and `/* */` comments (that's why `config.example.json` has inline comments). Config is searched at `CONFIG_PATH`, then `cwd/config.json`, then paths relative to the compiled file.

Required: `token`, `clientId`, `guildId`, `roles.verified`, `roles.blacklist`, `roles.admin[]`, `roles.mod[]`, `channels.review`, `channels.appealReview`, `questionCategoryId`. Optional: `roles.roleTag`, `channels.welcome|decisions|appeal|tagLog`. `admin`/`mod` accept a string or array.

Privileged **GuildMembers** intent must be enabled in the Discord Developer Portal, and the bot needs **Manage Server** for invite-based "join method" detection.

## Architecture

### Handler autoloading + routing
`handlers/loader.ts` scans `src/commands`, `src/buttons`, `src/modals` at startup and registers each module's `default` export into a `Collection` on the client. To add a feature you just drop a new file that default-exports the right shape (see `types.ts`): `SlashCommand` = `{ data, access?, execute }`; `ButtonHandler`/`ModalHandler` = `{ customId, execute }`. No central registry to edit.

`handlers/interactionCreate.ts` is the single router. Slash commands dispatch by `commandName` and are gated by `hasCommandAccess` (default access is `'admin'`). Buttons and modals are matched by iterating handlers and testing `customId` (string equality or `RegExp.test`) — **first match wins**, so keep customId patterns mutually exclusive.

### customId convention
Components encode state in the customId as `namespace:action[:targetId]`, e.g. `review:approve:<userId>`, `appeal:deny:<userId>`, `question:close:<channelId>`. Handlers with a dynamic target use a `RegExp` customId and `split(':')` out the action + id. The reason-collection flow chains: a `review:reject`/`blacklist` button opens a modal whose customId is `review:reason:<action>:<userId>`, handled by `modals/reviewReason.ts`. The `/чсп` slash command chains the same way — `commands/chsp.ts` opens a modal `chsp:reason:<userId>` (handled by `modals/chspReason.ts`) that collects the reason and then applies the blacklist. The handler must split the target `userId` out of its own customId; the slash command itself does nothing but show the modal.

### Two domains, one row per user
Everything is **applications** (verification) and **appeals** (amnesty). In `storage.ts` both tables key on `userId PRIMARY KEY`, so there is at most one application and one appeal per user — saving upserts and overwrites the previous one. Status state machines live in `types.ts`: `ApplicationStatus` = pending→approved/rejected/blacklisted/left/expired; `AppealStatus` = pending→amnestied/denied/left.

**Use the `claim*` functions for status transitions, not `updateApplication`/`saveApplication`.** `claimApplication`/`claimAppeal` do a guarded `UPDATE ... WHERE status='pending'` and return a boolean — this is the race guard that prevents two moderators clicking simultaneously from both succeeding. Always check the returned boolean and bail if `false` (the action was already processed). `review.ts` shows the pattern, including rolling the status back to `pending` if the subsequent `roles.add` fails. The exception is `/чсп` (`modals/chspReason.ts`): it's a direct moderator blacklist of any member — who may have no application row at all — so it upserts via `getApplication` + `updateApplication`/`saveApplication` rather than `claim*`. Don't "fix" it to use `claim*`.

### Schema migrations
`storage.ts` evolves the schema with idempotent `try { ALTER TABLE ... ADD COLUMN } catch {}` blocks at module load. When you add a field to `Application`/`Appeal`, you must (1) add the column to the `CREATE TABLE`, (2) add a guarded `ALTER TABLE` for existing DBs, and (3) thread it through the row interface, `rowToApp`/`rowToAppeal`, the `INSERT ... ON CONFLICT` upsert, and the `save*` binder. A `counters` table backs `nextApplicationNumber`/`nextAppealNumber` for sequential display numbers.

### Background workers (all registered in `index.ts`)
- `roleTag.ts` — detects the Discord **Server Tag** (`user.primaryGuild`, read in both camelCase and snake_case) and adds/removes `roles.roleTag`. It listens on `guildMemberAdd`/`guildMemberUpdate`/`userUpdate` **and a raw `GUILD_MEMBER_UPDATE` gateway packet**, because discord.js doesn't reliably surface tag changes. A per-member mutex (`runExclusive`) serializes role edits. `syncAllTagRoles` runs a full sweep on `clientReady`.
- `applicationCleanup.ts` — sweeps pending applications past a 48h TTL → `expired` (DMs user, deletes question channel, marks the review message resolved).
- `questionCleanup.ts` / `questionRestore.ts` — auto-delete question channels past 24h TTL; restore the "Ask a question" button when one closes.
- `leaveCleanup.ts` — marks pending application/appeal `left` when a member leaves.
- `inviteTracker.ts` — tracks which invite a member used (the "join method" shown on the form).

### Rendering layer
`ui.ts` is the single source of every embed and button row — the application/appeal review cards, the moderator decision buttons (`buildReviewButtons`/`buildAppealReviewButtons` encode the `review:*`/`appeal:*` customIds), the disabled "processed/left/expired" rows, DM embeds, the welcome embed, and the mirrored summary posted to `channels.decisions` via `postDecisionMessage`. Field values are wrapped in inline code and truncated to 1000 chars. Change UI here, not inline in handlers, so every flow stays consistent.

### Permissions
`permissions.ts` is two-tier. Slash commands: `commandAccessLevel` resolves `admin` (Discord Administrator perm **or** a `roles.admin` role) vs `mod` (a `roles.mod` role); `hasCommandAccess` lets admin do everything and mod do only `access: 'mod'` commands. Buttons call `isMod` themselves (Manage Roles perm, or any admin/mod role) since the router only auth-checks slash commands.

### Constraints to respect
- Discord modals allow **max 5 input fields** — `verifyQuestions` in `questions.ts` is already at the limit.
- Question channels are created under `config.questionCategoryId` with explicit permission overwrites for the applicant + every admin/mod role.
- `index.ts` requests intents `Guilds`, `GuildMembers`, `GuildInvites` and `Partials.GuildMember`; SIGINT/SIGTERM trigger a clean `closeDb()` + `client.destroy()`.
