---
name: claude-md-generator
description: Analyze a codebase and generate or improve CLAUDE.md documentation
---

# CLAUDE.md Generator

Generate comprehensive CLAUDE.md files for codebases to help future AI assistants work effectively.

## When to Use

- User asks to "create CLAUDE.md" or "analyze codebase for CLAUDE.md"
- User wants to improve existing CLAUDE.md
- Setting up a new project for AI-assisted development

## Process

### 1. Initial Analysis
- Read README.md, package.json, tsconfig.json, and other config files
- Identify the project type (Discord bot, web app, CLI tool, etc.)
- Understand the build system and dependencies

### 2. Architecture Discovery
- Map the directory structure
- Identify entry points (index.ts, main.ts, etc.)
- Understand the module/plugin system if any
- Find configuration patterns (env vars, config files, database)

### 3. Key Patterns to Document
- **Commands**: How to build, test, lint, run
- **Architecture**: High-level structure, module system, data flow
- **Configuration**: Required env vars, config files, database setup
- **Conventions**: Naming patterns, code style, important invariants

### 4. CLAUDE.md Structure

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
<One paragraph describing what this project does>

## Commands
<Build, run, test, lint commands>

## Architecture
<High-level structure, key modules, data flow>

## Configuration
<Env vars, config files, database setup>

## Key Patterns
<Important conventions, naming patterns, invariants>
```

### 5. What NOT to Include
- Obvious instructions ("write tests", "don't commit secrets")
- Every file in the project (can be discovered)
- Generic development practices
- Made-up sections like "Common Development Tasks" unless actually documented

## Example Prompt Template

```
Please analyze this codebase and create a CLAUDE.md file, which will be given to future instances of Claude Code to operate in this repository.

What to add:
1. Commands that will be commonly used, such as how to build, lint, and run tests
2. High-level code architecture and structure so that future instances can be productive more quickly

Usage notes:
- If there's already a CLAUDE.md, suggest improvements
- Do not repeat yourself
- Avoid listing every component or file structure
- Don't include generic development practices
```

## Output

A well-structured CLAUDE.md file that:
- Is concise but comprehensive
- Focuses on "big picture" architecture
- Includes essential commands
- Documents non-obvious patterns and conventions
- Helps AI assistants be productive immediately
