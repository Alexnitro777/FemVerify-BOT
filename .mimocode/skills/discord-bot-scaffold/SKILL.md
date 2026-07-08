---
name: discord-bot-scaffold
description: Create modular Discord bot structure with TypeScript and discord.js
---

# Discord Bot Scaffold

Generate a modular, extensible Discord bot structure with TypeScript.

## When to Use

- User asks to "create Discord bot structure" or "scaffold bot project"
- User wants a modular bot with plugin/extension system
- Starting a new Discord bot project

## Process

### 1. Project Structure

```
project/
├── src/
│   ├── index.ts          # Entry point, client setup
│   ├── config.ts         # Configuration loading
│   ├── types.ts          # Shared types
│   ├── commands/         # Slash commands
│   ├── buttons/          # Button handlers
│   ├── modals/           # Modal handlers
│   ├── events/           # Event handlers
│   ├── lib/              # Shared utilities
│   └── modules/          # Optional: modular features
├── docs/                 # Documentation
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
└── CLAUDE.md
```

### 2. Key Components

#### Handler Auto-Loading
```typescript
// handlers/loader.ts
// Scans commands/, buttons/, modals/ at startup
// Registers each module's default export into a Collection
```

#### Interaction Router
```typescript
// handlers/interactionCreate.ts
// Single router for all interactions
// Resolves GuildConfig, passes to handlers
```

#### Custom ID Convention
```
namespace:action[:targetId]
# Examples:
review:approve:userId
appeal:deny:userId
question:close:channelId
```

### 3. Configuration Pattern

- **Global config**: Environment variables for sensitive data (token, DB credentials)
- **Per-guild config**: Database table (guild_settings) for role/channel mappings
- **No config files on disk**: All state in database

### 4. Multi-Guild Support

```typescript
// Each guild has independent config
// Bot serves all guilds it's in
// Config cached per guild, invalidated on changes
```

### 5. Essential Features

- **Handler autoloading**: Drop a file, it's registered
- **Permission system**: Role-based access (staff, admin, owner)
- **Error handling**: Graceful degradation, user-friendly messages
- **Database migrations**: Idempotent schema updates at boot
- **Background workers**: Cleanup tasks, scheduled operations

## Output

A complete bot structure with:
- Modular handler system
- Multi-guild configuration
- Role-based permissions
- Database integration
- Docker deployment setup
- CLAUDE.md documentation
