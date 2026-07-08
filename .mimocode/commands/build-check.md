---
description: Run TypeScript build verification with error reporting
---

# Build Check Command

Run the TypeScript build and report errors concisely.

## Usage

```bash
/build-check [project-path]
```

## Implementation

1. If project-path is provided, cd to that directory first
2. Run `npm run build 2>&1 | tail -30`
3. If build fails, also run `npx tsc --noEmit 2>&1 | head -40` for detailed errors
4. Report: build success/failure, error count, and first few errors if any

## Example Output

```
✅ Build succeeded (FemVerify-BOT)
   No TypeScript errors

or

❌ Build failed (FemAction-BOT)
   3 TypeScript errors found:
   1. src/events/activity.ts:45 - Property 'xyz' does not exist on type 'GuildMember'
   2. src/commands/help.ts:23 - Argument of type 'string' is not assignable to parameter of type 'number'
   3. ...
```
