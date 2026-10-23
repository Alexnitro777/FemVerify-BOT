# Graph Report - FemVerify-BOT  (2026-10-21)

## Corpus Check
- 69 files · ~38,884 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 4 file(s) not represented in the graph (top: (none) 4)

## Summary
- 516 nodes · 1451 edges · 22 communities (21 shown, 1 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 68 edges (avg confidence: 0.94)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bd9ff910`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Discord Bot UI Components
- Application Review Logic
- Project Dependencies
- App Configuration and Registration
- ui.ts
- Member Join Synchronization
- schema.ts
- II-A. Со стороны УЧАСТНИКА
- Invite Tracking System
- Guild Role Tagging
- TypeScript Configuration
- I-B. Со стороны МОДЕРАТОРА
- permissions.ts
- Privileged Gateway Intents в FemVerify-BOT
- README.md
- Права доступа — кто что видит и может
- 5. Возможные исходы для участника после отправки
- I-A. Со стороны УЧАСТНИКА
- FemVerify-BOT
- Ponytail, lazy senior dev mode
- Architecture
- Функции бота — краткий обзор

## God Nodes (most connected - your core abstractions)
1. `discord.js` - 48 edges
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

## Communities (22 total, 1 thin omitted)

### Community 0 - "Discord Bot UI Components"
Cohesion: 0.06
Nodes (61): Handler autoloading + routing, Schema migrations, 0. Глоссарий статусов, discord.js, drizzle-orm, mysql2, handler, handler (+53 more)

### Community 1 - "Application Review Logic"
Cohesion: 0.10
Nodes (55): Two domains, one row per user, 8. Хранилище данных (MySQL/MariaDB), 3.4. Получение списка участников и синхронизация (`guild.members.fetch()`), 4. Конкурентность, 7. Команда `/выдатьчсп` — занесение в ЧС напрямую (`commands/chsp.ts`), 9. Автовыдача ЧСП через канал-ловушку (`trapChannel.ts`), closeExpiredApplication(), registerApplicationCleanup() (+47 more)

### Community 2 - "Project Dependencies"
Cohesion: 0.07
Nodes (27): dependencies, bufferutil, discord.js, drizzle-orm, mysql2, zlib-sync, description, devDependencies (+19 more)

### Community 3 - "App Configuration and Registration"
Cohesion: 0.09
Nodes (36): Configuration, enforceChsaProtection(), registerChsaProtection(), buildCommandBodies(), getRest(), registerCommandsForGuild(), getAppConfig(), initAppConfig() (+28 more)

### Community 4 - "ui.ts"
Cohesion: 0.08
Nodes (42): Rendering layer, handler, DeleteQuestionChannelOptions, fetchAllMessages(), logQuestionChannel(), handleMemberRemove(), markReviewMessageLeft(), ParsedMessageUrl (+34 more)

### Community 5 - "Member Join Synchronization"
Cohesion: 0.15
Nodes (26): getGuildConfig(), ComponentHandler, ComponentInteraction, dispatch(), handleInteraction(), interactionLabel(), reportError(), runChatInputCommand() (+18 more)

### Community 6 - "schema.ts"
Cohesion: 0.22
Nodes (8): appConfig, appeals, applications, counters, guildSettings, joinMethods, questions, specialBlacklists

### Community 7 - "II-A. Со стороны УЧАСТНИКА"
Cohesion: 0.09
Nodes (23): 1. Где появляются апелляции, 1. Точка входа, 2. Проверки ДО открытия формы (`appealStart.ts`), 2. Три действия по апелляции (`appealReview.ts`), 3.1. ✅ Принять амнистию, 3.2. ❌ Отказать в амнистии, 3.3. ❓ Задать вопрос, 3. Детали (+15 more)

### Community 8 - "Invite Tracking System"
Cohesion: 0.13
Nodes (28): mapWithConcurrency(), CachedInvite, cacheGuildInvites(), DeletedInvite, detectJoinMethod(), detectJoinMethodLocked(), detectJoinMethodWithRetry(), formatInviter() (+20 more)

### Community 9 - "Guild Role Tagging"
Cohesion: 0.12
Nodes (24): command, syncMember(), SyncTotals, command, lastFullFetch, handleMemberJoin(), registerMemberJoin(), applyTagRole() (+16 more)

### Community 10 - "TypeScript Configuration"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir, resolveJsonModule (+7 more)

### Community 11 - "I-B. Со стороны МОДЕРАТОРА"
Cohesion: 0.17
Nodes (12): 1. Где появляются заявки, 2. Четыре решения по заявке (`review.ts`), 3.1. ✅ Принять, 3.2. ❌ Отклонить (`reviewReason.ts`), 3.3. ❓ Задать вопрос, 3.4. 🚫 ЧС (`reviewReason.ts`), 3. Детали по каждому решению, 4. Конкурентность и идемпотентность (+4 more)

### Community 12 - "permissions.ts"
Cohesion: 0.18
Nodes (11): AccessLevel, buttonAccessLevel(), canManageByHierarchy(), canManageRoles(), commandAccessLevel(), hasCommandAccess(), memberRoleIds(), OWNER_IDS (+3 more)

### Community 13 - "Privileged Gateway Intents в FemVerify-BOT"
Cohesion: 0.20
Nodes (10): 1. Что такое Gateway Intents и Privileged Intents, 2. Какие интенты настроены в FemVerify-BOT, 3.1. Вход новых участников (`Events.GuildMemberAdd` / `src/memberJoin.ts`), 3.2. Выход участников с сервера (`Events.GuildMemberRemove` / `src/leaveCleanup.ts`), 3.3. Отслеживание тега сервера и статусов (`GUILD_MEMBER_UPDATE` / `src/roleTag.ts` и `src/voiceKick.ts`), 3. Зачем боту нужен `GuildMembers` (Server Members Intent), 4. Другие привилегированные интенты, 5. Обычные (непривилегированные) интенты бота (+2 more)

### Community 15 - "Права доступа — кто что видит и может"
Cohesion: 0.29
Nodes (7): 1. Слеш-команды, 2. Кнопки модерации, 3. Кнопки для участников (верификация / апелляция), 4. Видимость приватных каналов-вопросов, 5. Иммунитет к каналу-ловушке (`channels.trap`), Важные нюансы, Права доступа — кто что видит и может

### Community 16 - "5. Возможные исходы для участника после отправки"
Cohesion: 0.29
Nodes (7): 5.1. ✅ Заявку ОДОБРИЛИ, 5.2. ❌ Заявку ОТКЛОНИЛИ, 5.3. 🚫 Отправили в ЧС, 5.4. ❓ Модератор ЗАДАЛ ВОПРОС, 5.5. ⌛ Заявка АВТО-ЗАКРЫТА (expired), 5.6. 🚪 Участник ПОКИНУЛ сервер (left), 5. Возможные исходы для участника после отправки

### Community 17 - "I-A. Со стороны УЧАСТНИКА"
Cohesion: 0.33
Nodes (6): 1. Точка входа, 2. Проверки ДО открытия анкеты (`verifyStart.ts`), 3. Заполнение анкеты (модалка `verify:submit`), 4. Отправка анкеты (`verifySubmit.ts`), 6. Сводка ограничений участника при верификации, I-A. Со стороны УЧАСТНИКА

### Community 18 - "FemVerify-BOT"
Cohesion: 0.33
Nodes (6): 1. Структура проекта, 2.1. Предварительные требования, 2.2. Установка и запуск, 2. Быстрый старт с Docker, 3. Управление контейнером, FemVerify-BOT

### Community 19 - "Ponytail, lazy senior dev mode"
Cohesion: 0.50
Nodes (3): Before you write, Ponytail, lazy senior dev mode, The smallest complete change

### Community 20 - "Architecture"
Cohesion: 0.17
Nodes (10): Architecture, Background workers (all registered in `index.ts`), Commands, Constraints to respect, customId convention, Docs convention, Hard rule: no comments, Permissions (+2 more)

### Community 21 - "Функции бота — краткий обзор"
Cohesion: 0.20
Nodes (10): 1. Слеш-команды, 2. Верификация участников, 3. Апелляции (для участников в ЧС), 4. Способ вступления (трекинг инвайтов), 5. Автовыдача роли за тег сервера (Server Tag), 6. Каналы-вопросы, 7. Фоновые задачи и автоматика, 9. Конфигурация (+2 more)

## Knowledge Gaps
- **6 isolated node(s):** `bufferutil`, `zlib-sync`, `@types/node`, `drizzle-kit`, `tsx` (+1 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 183 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `discord.js` connect `Discord Bot UI Components` to `Application Review Logic`, `Project Dependencies`, `App Configuration and Registration`, `ui.ts`, `Member Join Synchronization`, `Invite Tracking System`, `Guild Role Tagging`, `permissions.ts`?**
  _High betweenness centrality (0.140) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `GuildConfig` (e.g. with `Background workers (all registered in `index.ts`)` and `Configuration`) actually correct?**
  _`GuildConfig` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `bufferutil`, `zlib-sync`, `@types/node` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Discord Bot UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.05692883895131086 - nodes in this community are weakly interconnected._
- **Why does `claimAppeal()` connect `Application Review Logic` to `Discord Bot UI Components`?**
  _High betweenness centrality (0.101) - this node is a cross-community bridge._
- **Should `Application Review Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.10240384615384615 - nodes in this community are weakly interconnected._
- **Why does `I-B. Со стороны МОДЕРАТОРА` connect `I-B. Со стороны МОДЕРАТОРА` to `Application Review Logic`, `README.md`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._