# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Discord verification bot (discord.js v14). New members fill an application form (anketa), moderators approve/reject/blacklist, blacklisted users can submit appeals. The bot also auto-grants a role to members displaying the server's Server Tag. All user-facing strings are in Russian. Slash command names are Russian (`/верификация`, `/апелляции`, `/тег`, `/формы`, `/формычсп`).

## Commands

```bash
npm run dev      # ts-node-dev watch mode (local development)
npm run build    # tsc -> dist/
npm run start    # node --experimental-sqlite dist/index.js  (run after build)
npm run deploy   # register slash commands with Discord (guild-scoped)
```

- Requires **Node >= 22.5.0** — uses the built-in `node:sqlite` module, hence the `--experimental-sqlite` flag everywhere.
- There is **no test runner and no linter configured**. "Verifying" a change means `npm run build` (type-check) plus manual testing against a Discord guild.
- New or changed slash commands only take effect after `npm run deploy`. The Docker entrypoint runs deploy automatically on container start; `docker compose restart` re-runs it.
- Config lives in `config.json` (gitignored; copy from `config.example.json`). `CONFIG_PATH` env var overrides the location. `config.json` supports `//` and `/* */` comments (stripped by `src/config.ts`).

## Architecture

**Entry point** (`src/index.ts`) creates the client with only `Guilds` + `GuildMembers` intents, autoloads handlers, registers background event listeners, then logs in. SQLite is closed cleanly on SIGINT/SIGTERM.

**Handler autoloading** (`src/handlers/loader.ts`): every `.ts`/`.js` file in `src/commands/`, `src/buttons/`, `src/modals/` must `export default` an object matching the matching interface in `src/types.ts` (`SlashCommand` / `ButtonHandler` / `ModalHandler`). Adding a feature = drop a new file in the right folder; no central registration. Commands key on `data.name`; buttons/modals key on a `customId` that is either a literal string or a `RegExp`.

**Interaction routing** (`src/handlers/interactionCreate.ts`): the single `interactionCreate` listener dispatches. Commands match by name and are gated by `cmd.access` (`'admin'` default, or `'mod'`) via `src/permissions.ts`. Buttons and modals are matched by **iterating all handlers** and testing each `customId` (string equality or `RegExp.test`) — first match wins, so keep customId patterns non-overlapping. All errors bubble to one try/catch that replies/edits/followUps an ephemeral error message depending on interaction state.

**customId convention**: namespaced with `:` — e.g. `verify:start`, `verify:submit`, `appeal:start`. Decision buttons encode the target user id in the customId and parse it with a RegExp (see `src/buttons/review.ts`, `appealReview.ts`). When a flow spans button → modal, the button opens a modal whose customId carries the context the modal handler needs.

**Permissions** (`src/permissions.ts`): two levels. `admin` = Discord Administrator permission OR a role in `config.roles.admin`. `mod` = a role in `config.roles.mod`. Admin implies mod. `isMod` (used by review buttons) also accepts the `ManageRoles` permission.

**Storage** (`src/storage.ts`): synchronous `node:sqlite`, WAL mode, file at `data/bot.db` (created on first run). Two tables keyed by `userId` (one row per user, upserted): `applications` and `appeals`. Schema migrations are done with idempotent `ALTER TABLE ... ADD COLUMN` calls wrapped in empty `try/catch` — **add new columns this way**, never edit the original CREATE. Status transitions that must be race-safe (two mods clicking at once) use `claimApplication`/`claimAppeal`, which do a conditional `UPDATE ... WHERE status='pending'` and return whether exactly one row changed — check this boolean before acting.

**Status lifecycles** (`src/types.ts`): application = `pending → approved | rejected | blacklisted | left | expired`; appeal = `pending → amnestied | denied | left`. `left` is set by cleanup when the user leaves the guild.

**Background workers** registered in `index.ts`:
- `roleTag.ts` — watches `guildMemberAdd` / `guildMemberUpdate` / `userUpdate` / raw `GUILD_MEMBER_UPDATE` gateway packets to add/remove `config.roles.roleTag` based on whether the user's Server Tag (`primaryGuild`) points at `config.guildId`. Per-member async lock (`runExclusive`) prevents add/remove races. Full sync runs once on ready. Disabled if `roles.roleTag` is unset.
- `leaveCleanup.ts` — on member leave, marks pending application/appeal as `left` and edits the review message.
- `questionCleanup.ts` — sweeps interview channels (`questionChannelId`) older than a TTL.
- `applicationCleanup.ts` — auto-closes pending applications past a 2-day TTL (sets `expired`).

**UI** (`src/ui.ts`) is the single place that builds embeds and button rows; flow files call its builders rather than constructing components inline.

**Config shape** (`src/config.ts`): validated at load with `required`/`optional`/`requiredList` helpers that throw on missing required keys, so a bad config fails fast at startup. `roles.admin`/`roles.mod` accept a string or string array. See `config.example.json` for every key and which are optional.

## Conventions

- **НИКОГДА не добавляй комментарии в файлы** — ни в `.ts`, ни в `.json`, ни в какие другие. Единственное исключение — `config.example.json`, где комментарии допустимы и нужны. Никогда не трогай комментарии в `config.example.json` — даже если пользователь просит удалить комментарии везде/во всём проекте, этот файл нужно оставить нетронутым.
- TypeScript `strict` is on. Prefer the existing pattern of narrowing `unknown`/`any` from discord.js partials over loosening types globally (see `memberRoleIds`, `roleTag.ts` normalizers).
- Discord modals allow at most 5 text inputs — `verifyQuestions` in `src/questions.ts` is sliced to 5. Edit questions there.
- Use `MessageFlags.Ephemeral` for user-facing replies that shouldn't be public (the codebase does this consistently).
