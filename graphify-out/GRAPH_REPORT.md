# Graph Report - FemVerify-BOT  (2026-10-29)

## Corpus Check
- 70 files · ~39,092 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 4)

## Summary
- 538 nodes · 1481 edges · 23 communities (22 shown, 1 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `511bdc5b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- types.ts
- Application Review Logic
- Project Dependencies
- App Configuration and Registration
- ui.ts
- Member Join Synchronization
- environment
- II-A. Со стороны УЧАСТНИКА
- Invite Tracking System
- logSettledFailures
- TypeScript Configuration
- I-B. Со стороны МОДЕРАТОРА
- permissions.ts
- Privileged Gateway Intents в FemVerify-BOT
- README.md
- Права доступа — кто что видит и может
- 5. Возможные исходы для участника после отправки
- storage.ts
- FemVerify-BOT
- Ponytail + Graphify, lazy senior dev mode
- Architecture
- Функции бота — краткий обзор
- 3. Детали по каждому решению

## God Nodes (most connected - your core abstractions)
1. `discord.js` - 49 edges
2. `GuildConfig` - 39 edges
3. `logSettledFailures()` - 34 edges
4. `getGuildConfig()` - 30 edges
5. `getApplication()` - 27 edges
6. `bootstrap()` - 26 edges
7. `postDecisionMessage()` - 24 edges
8. `deleteQuestionChannel()` - 21 edges
9. `handleTrapMessage()` - 19 edges
10. `applyGlobalBlacklist()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `Docs convention` --references--> `build()`  [INFERRED]
  CLAUDE.md → src/guildConfig.ts
- `8. Команда `/снятьчсп` — снятие с ЧС напрямую (`commands/unchsp.ts`)` --references--> `restoreMemberRoles()`  [INFERRED]
  docs/verification-and-appeals.md → src/roles.ts
- `3.1. Вход новых участников (`Events.GuildMemberAdd` / `src/memberJoin.ts`)` --references--> `getUserGlobalStatus()`  [INFERRED]
  docs/gateway-intents.md → src/storage.ts
- `4. Конкурентность и идемпотентность` --references--> `claimApplication()`  [INFERRED]
  docs/verification-and-appeals.md → src/storage.ts
- `Защита от спама и взломов (Канал-ловушка)` --references--> `applyGlobalBlacklist()`  [INFERRED]
  docs/features.md → src/sync.ts

## Import Cycles
- None detected.

## Communities (23 total, 1 thin omitted)

### Community 0 - "types.ts"
Cohesion: 0.07
Nodes (45): Handler autoloading + routing, Permissions, discord.js, drizzle-orm, handler, handler, handler, handler (+37 more)

### Community 1 - "Application Review Logic"
Cohesion: 0.12
Nodes (44): 3.4. Получение списка участников и синхронизация (`guild.members.fetch()`), 9. Автовыдача ЧСП через канал-ловушку (`trapChannel.ts`), blacklistRoleFor(), DmTexts, handleDecision(), handleQuestion(), handler, resolveMember() (+36 more)

### Community 2 - "Project Dependencies"
Cohesion: 0.09
Nodes (28): dependencies, bufferutil@^4.0.9, discord.js@^14.27.0, drizzle-orm@^0.45.2, mysql2@^3.23.0, zlib-sync@^0.1.10, description, devDependencies (+20 more)

### Community 3 - "App Configuration and Registration"
Cohesion: 0.08
Nodes (40): Configuration, registerApplicationCleanup(), enforceChsaProtection(), registerChsaProtection(), buildCommandBodies(), getRest(), registerCommandsForGuild(), getAppConfig() (+32 more)

### Community 4 - "ui.ts"
Cohesion: 0.11
Nodes (32): Rendering layer, DeleteQuestionChannelOptions, fetchAllMessages(), logQuestionChannel(), editReviewMessage(), restoreReviewButton(), getAppealByQuestionChannel(), getApplicationByQuestionChannel() (+24 more)

### Community 5 - "Member Join Synchronization"
Cohesion: 0.27
Nodes (17): getGuildConfig(), getTrapKicksCount(), incrementTrapKicksCount(), activeTrapMessages, channelLocks, ensureTrapChannelMessage(), handleMessageBulkDelete(), handleMessageDelete() (+9 more)

### Community 6 - "environment"
Cohesion: 0.10
Nodes (19): build, container_name, environment, image, init, restart, tty, BOT_TOKEN (+11 more)

### Community 7 - "II-A. Со стороны УЧАСТНИКА"
Cohesion: 0.09
Nodes (23): 1. Где появляются апелляции, 1. Точка входа, 2. Проверки ДО открытия формы (`appealStart.ts`), 2. Три действия по апелляции (`appealReview.ts`), 3.1. ✅ Принять амнистию, 3.2. ❌ Отказать в амнистии, 3.3. ❓ Задать вопрос, 3. Детали (+15 more)

### Community 8 - "Invite Tracking System"
Cohesion: 0.20
Nodes (18): CachedInvite, cacheGuildInvites(), DeletedInvite, detectJoinMethod(), detectJoinMethodLocked(), detectJoinMethodWithRetry(), formatInviter(), GuildInviteState (+10 more)

### Community 9 - "logSettledFailures"
Cohesion: 0.09
Nodes (40): closeExpiredApplication(), sweep(), SWEEP_INTERVAL_MS, sweepGuild(), command, syncMember(), SyncTotals, command (+32 more)

### Community 10 - "TypeScript Configuration"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir, resolveJsonModule (+7 more)

### Community 11 - "I-B. Со стороны МОДЕРАТОРА"
Cohesion: 0.29
Nodes (7): 1. Где появляются заявки, 2. Четыре решения по заявке (`review.ts`), 4. Конкурентность и идемпотентность, 5. Обзор очереди, 6. Что модератор видит при авто-событиях, 8. Команда `/снятьчсп` — снятие с ЧС напрямую (`commands/unchsp.ts`), I-B. Со стороны МОДЕРАТОРА

### Community 12 - "permissions.ts"
Cohesion: 0.08
Nodes (25): command, ImportTotals, ComponentHandler, ComponentInteraction, dispatch(), handleInteraction(), interactionLabel(), reportError() (+17 more)

### Community 13 - "Privileged Gateway Intents в FemVerify-BOT"
Cohesion: 0.20
Nodes (10): 1. Что такое Gateway Intents и Privileged Intents, 2. Какие интенты настроены в FemVerify-BOT, 3.1. Вход новых участников (`Events.GuildMemberAdd` / `src/memberJoin.ts`), 3.2. Выход участников с сервера (`Events.GuildMemberRemove` / `src/leaveCleanup.ts`), 3.3. Отслеживание тега сервера и статусов (`GUILD_MEMBER_UPDATE` / `src/roleTag.ts` и `src/voiceKick.ts`), 3. Зачем боту нужен `GuildMembers` (Server Members Intent), 4. Другие привилегированные интенты, 5. Обычные (непривилегированные) интенты бота (+2 more)

### Community 15 - "Права доступа — кто что видит и может"
Cohesion: 0.29
Nodes (7): 1. Слеш-команды, 2. Кнопки модерации, 3. Кнопки для участников (верификация / апелляция), 4. Видимость приватных каналов-вопросов, 5. Иммунитет к каналу-ловушке (`channels.trap`), Важные нюансы, Права доступа — кто что видит и может

### Community 16 - "5. Возможные исходы для участника после отправки"
Cohesion: 0.15
Nodes (13): 1. Точка входа, 2. Проверки ДО открытия анкеты (`verifyStart.ts`), 3. Заполнение анкеты (модалка `verify:submit`), 4. Отправка анкеты (`verifySubmit.ts`), 5.1. ✅ Заявку ОДОБРИЛИ, 5.2. ❌ Заявку ОТКЛОНИЛИ, 5.3. 🚫 Отправили в ЧС, 5.4. ❓ Модератор ЗАДАЛ ВОПРОС (+5 more)

### Community 17 - "storage.ts"
Cohesion: 0.10
Nodes (31): Schema migrations, Two domains, one row per user, 8. Хранилище данных (MySQL/MariaDB), 0. Глоссарий статусов, 4. Конкурентность, 7. Команда `/выдатьчсп` — занесение в ЧС напрямую (`commands/chsp.ts`), addColumnIfMissing(), addIndexIfMissing() (+23 more)

### Community 18 - "FemVerify-BOT"
Cohesion: 0.33
Nodes (6): 1. Структура проекта, 2.1. Предварительные требования, 2.2. Установка и запуск, 2. Быстрый старт с Docker, 3. Управление контейнером, FemVerify-BOT

### Community 19 - "Ponytail + Graphify, lazy senior dev mode"
Cohesion: 0.40
Nodes (4): Before you write (Graph-First Scoping), Execution & Graph Discipline, Ponytail + Graphify, lazy senior dev mode, The smallest complete change

### Community 20 - "Architecture"
Cohesion: 0.18
Nodes (9): Architecture, Background workers (all registered in `index.ts`), Commands, Constraints to respect, customId convention, Docs convention, Hard rule: no comments, Role stripping & restore (the `removedRoles` round-trip) (+1 more)

### Community 21 - "Функции бота — краткий обзор"
Cohesion: 0.20
Nodes (10): 1. Слеш-команды, 2. Верификация участников, 3. Апелляции (для участников в ЧС), 4. Способ вступления (трекинг инвайтов), 5. Автовыдача роли за тег сервера (Server Tag), 6. Каналы-вопросы, 7. Фоновые задачи и автоматика, 9. Конфигурация (+2 more)

### Community 26 - "3. Детали по каждому решению"
Cohesion: 0.40
Nodes (5): 3.1. ✅ Принять, 3.2. ❌ Отклонить (`reviewReason.ts`), 3.3. ❓ Задать вопрос, 3.4. 🚫 ЧС (`reviewReason.ts`), 3. Детали по каждому решению

## Knowledge Gaps
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `discord.js` connect `types.ts` to `Application Review Logic`, `Project Dependencies`, `App Configuration and Registration`, `ui.ts`, `Member Join Synchronization`, `Invite Tracking System`, `logSettledFailures`, `permissions.ts`?**
  _High betweenness centrality (0.126) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `GuildConfig` (e.g. with `Background workers (all registered in `index.ts`)` and `Configuration`) actually correct?**
  _`GuildConfig` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Should `types.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0676056338028169 - nodes in this community are weakly interconnected._
- **Why does `claimAppeal()` connect `storage.ts` to `Application Review Logic`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Should `Application Review Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.12066365007541478 - nodes in this community are weakly interconnected._
- **Why does `I-B. Со стороны МОДЕРАТОРА` connect `I-B. Со стороны МОДЕРАТОРА` to `storage.ts`, `3. Детали по каждому решению`, `Application Review Logic`, `README.md`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Should `Project Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.08620689655172414 - nodes in this community are weakly interconnected._