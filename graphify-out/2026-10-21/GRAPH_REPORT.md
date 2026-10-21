# Graph Report - FemVerify-BOT  (2026-10-21)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 387 nodes · 1221 edges · 13 communities
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.85)
- Token cost: 728 input · 126 output

## Graph Freshness
- Built from commit: `c6417d3a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Discord Bot UI Components
- Application Review Logic
- Project Dependencies
- App Configuration and Registration
- Question Channel Management
- Member Join Synchronization
- Data Storage and Import
- Automated Cleanup Tasks
- Invite Tracking System
- Guild Role Tagging
- TypeScript Configuration
- Guild Settings Caching
- Interaction Handling

## God Nodes (most connected - your core abstractions)
1. `discord.js` - 45 edges
2. `GuildConfig` - 33 edges
3. `logSettledFailures()` - 33 edges
4. `getGuildConfig()` - 28 edges
5. `bootstrap()` - 25 edges
6. `getApplication()` - 24 edges
7. `postDecisionMessage()` - 23 edges
8. `deleteQuestionChannel()` - 21 edges
9. `handleTrapMessage()` - 19 edges
10. `markReviewMessageResolved()` - 17 edges

## Surprising Connections (you probably didn't know these)
- `ComponentHandler` --references--> `GuildConfig`  [EXTRACTED]
  src/handlers/interactionCreate.ts → src/types.ts
- `handleTrapMessage()` --calls--> `getMainGuildInvite()`  [EXTRACTED]
  src/trapChannel.ts → src/config.ts
- `handleTrapMessage()` --calls--> `isMainGuild()`  [EXTRACTED]
  src/trapChannel.ts → src/config.ts
- `handleDecision()` --calls--> `logSettledFailures()`  [EXTRACTED]
  src/buttons/appealReview.ts → src/concurrency.ts
- `handleDecision()` --calls--> `buildDmEmbed()`  [EXTRACTED]
  src/buttons/appealReview.ts → src/ui.ts

## Import Cycles
- None detected.

## Communities (13 total, 0 thin omitted)

### Community 0 - "Discord Bot UI Components"
Cohesion: 0.08
Nodes (41): discord.js, handler, handler, handler, handler, handler, handler, handler (+33 more)

### Community 1 - "Application Review Logic"
Cohesion: 0.12
Nodes (42): blacklistRoleFor(), DmTexts, handleDecision(), handleQuestion(), handler, resolveMember(), handleApprove(), handleQuestion() (+34 more)

### Community 2 - "Project Dependencies"
Cohesion: 0.05
Nodes (38): dependencies, bufferutil, discord.js, drizzle-orm, mysql2, zlib-sync, description, devDependencies (+30 more)

### Community 3 - "App Configuration and Registration"
Cohesion: 0.13
Nodes (22): buildCommandBodies(), getRest(), registerCommandsForGuild(), AppConfig, getAppConfig(), initAppConfig(), resolve(), resolveOptional() (+14 more)

### Community 4 - "Question Channel Management"
Cohesion: 0.11
Nodes (30): DeleteQuestionChannelOptions, fetchAllMessages(), logQuestionChannel(), editReviewMessage(), restoreReviewButton(), getAppealByQuestionChannel(), getApplicationByQuestionChannel(), ModeratorStats (+22 more)

### Community 5 - "Member Join Synchronization"
Cohesion: 0.14
Nodes (29): command, syncMember(), SyncTotals, getGuildConfig(), handleMemberJoin(), registerMemberJoin(), isOwner(), blacklistMemberRoles() (+21 more)

### Community 6 - "Data Storage and Import"
Cohesion: 0.08
Nodes (27): command, ImportTotals, addColumnIfMissing(), addIndexIfMissing(), ClaimedAppeal, ClaimedApplication, getJoinMethod(), getModeratorStats() (+19 more)

### Community 7 - "Automated Cleanup Tasks"
Cohesion: 0.19
Nodes (20): closeExpiredApplication(), registerApplicationCleanup(), sweep(), SWEEP_INTERVAL_MS, sweepGuild(), logSettledFailures(), mapWithConcurrency(), isChannelNotFoundError() (+12 more)

### Community 8 - "Invite Tracking System"
Cohesion: 0.20
Nodes (18): CachedInvite, cacheGuildInvites(), DeletedInvite, detectJoinMethod(), detectJoinMethodLocked(), detectJoinMethodWithRetry(), formatInviter(), GuildInviteState (+10 more)

### Community 9 - "Guild Role Tagging"
Cohesion: 0.21
Nodes (14): command, lastFullFetch, applyTagRole(), getPrimaryGuild(), hasServerTag(), infoIsOurTag(), normalizePrimaryGuild(), PrimaryGuildInfo (+6 more)

### Community 10 - "TypeScript Configuration"
Cohesion: 0.12
Nodes (15): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, outDir, resolveJsonModule (+7 more)

### Community 11 - "Guild Settings Caching"
Cohesion: 0.27
Nodes (12): build(), buildAndCache(), cache, inflight, load(), optional(), optionalList(), required() (+4 more)

### Community 12 - "Interaction Handling"
Cohesion: 0.26
Nodes (10): ComponentHandler, ComponentInteraction, dispatch(), handleInteraction(), interactionLabel(), reportError(), runChatInputCommand(), runComponent() (+2 more)

## Knowledge Gaps
- **6 isolated node(s):** `bufferutil`, `drizzle-kit`, `tsx`, `@types/node`, `typescript` (+1 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 114 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `discord.js` connect `Discord Bot UI Components` to `Application Review Logic`, `Project Dependencies`, `App Configuration and Registration`, `Question Channel Management`, `Member Join Synchronization`, `Data Storage and Import`, `Automated Cleanup Tasks`, `Invite Tracking System`, `Guild Role Tagging`, `Interaction Handling`?**
  _High betweenness centrality (0.186) - this node is a cross-community bridge._
- **What connects `bufferutil`, `drizzle-kit`, `tsx` to the rest of the system?**
  _6 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Discord Bot UI Components` be split into smaller, more focused modules?**
  _Cohesion score 0.08499743983614952 - nodes in this community are weakly interconnected._
- **Why does `logSettledFailures()` connect `Automated Cleanup Tasks` to `Discord Bot UI Components`, `Application Review Logic`, `App Configuration and Registration`, `Member Join Synchronization`, `Invite Tracking System`, `Guild Role Tagging`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Should `Application Review Logic` be split into smaller, more focused modules?**
  _Cohesion score 0.1196808510638298 - nodes in this community are weakly interconnected._
- **Why does `GuildConfig` connect `Discord Bot UI Components` to `Application Review Logic`, `Question Channel Management`, `Member Join Synchronization`, `Data Storage and Import`, `Automated Cleanup Tasks`, `Guild Role Tagging`, `Guild Settings Caching`, `Interaction Handling`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **Should `Project Dependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04756871035940803 - nodes in this community are weakly interconnected._