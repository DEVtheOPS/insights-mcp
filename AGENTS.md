# insights-mcp - Agent Instructions

## Project Overview

MCP server for persistent memory storage in Claude Code sessions. Allows Claude to save and retrieve project-specific insights across sessions with full-text search.

## Technology Stack

- **Language:** TypeScript (ES2022 modules)
- **Runtime:** Node.js >= 18
- **MCP SDK:** @modelcontextprotocol/sdk v1.0.4+
- **Database:** better-sqlite3 with FTS5 full-text search
- **Validation:** Zod for schema validation
- **CLI:** Commander.js
- **HTTP:** Express.js
- **Build:** TypeScript compiler

## Project Structure

```text
insights-mcp/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── server.ts             # MCP server setup & tool registration
│   ├── database.ts           # SQLite database operations
│   ├── types.ts              # TypeScript interfaces
│   └── transports/
│       ├── stdio.ts          # Stdio transport
│       └── http.ts           # HTTP transport
├── dist/                     # Compiled output (gitignored)
├── docs/
│   └── plans/               # Implementation plans
├── package.json
├── tsconfig.json
└── README.md
```

## Development Workflow

### Build & Run

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode (watch)
npm run dev

# Run (stdio mode)
npm start
# or
node dist/index.js --mode stdio

# Run (HTTP mode)
node dist/index.js --mode http --port 3000
```

### Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

#### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Auto-syncs to JSONL for version control
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

#### Quick Start

**Check for ready work:**
```bash
bd ready --json
```

**Create new issues:**
```bash
bd create "Issue title" -t bug|feature|task -p 0-4 --json
bd create "Issue title" -p 1 --deps discovered-from:bd-123 --json
```

**Create epics for large projects:**
```bash
bd epic create "Epic title" -p 1 --json
bd create "Subtask 1" -t task -p 1 --deps blocks:bd-epic-1 --json
bd create "Subtask 2" -t task -p 1 --deps blocks:bd-epic-1 --json
```

**Claim and update:**
```bash
bd update bd-42 --status in_progress --json
bd update bd-42 --priority 1 --json
```

**Complete work:**
```bash
bd close bd-42 --reason "Completed" --json
```

#### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

#### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

#### Using Epics for Large Projects

**IMPORTANT**: For any project or task that is relatively large and might take multiple sessions or compacts to complete, ALWAYS create an epic with linked subtasks.

**When to use epics:**
- Project will span multiple work sessions
- Work might survive multiple context compactions
- Task has multiple distinct phases or components
- Implementation requires coordination across multiple files or systems
- Total work exceeds what can be completed in a single focused session

**Epic workflow:**
1. Create the epic: `bd epic create "Large Feature Name" -p 1 --json`
2. Break down into subtasks: `bd create "Subtask" -t task --deps blocks:bd-epic-123 --json`
3. Work on ready subtasks: `bd ready --json` (shows unblocked subtasks)
4. Close subtasks as completed: `bd close bd-456 --reason "Done" --json`
5. Epic automatically closes when all blocking subtasks are complete

**Benefits:**
- ✅ Survives context compaction and session boundaries
- ✅ Clear progress tracking across multiple sessions
- ✅ Each subtask is focused and manageable
- ✅ Dependencies ensure work happens in correct order
- ✅ Easy to resume work after interruptions

#### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Large task?** Create epic first, then break into subtasks
3. **Claim your task**: `bd update <id> --status in_progress`
4. **Work on it**: Implement, test, document
5. **Discover new work?** Create linked issue:
   - `bd create "Found bug" -p 1 --deps discovered-from:<parent-id>`
6. **Complete**: `bd close <id> --reason "Done"`
7. **Commit together**: Always commit the `.beads/issues.jsonl` file together with the code changes so issue state stays in sync with code state

#### Auto-Sync

bd automatically syncs with git:
- Exports to `.beads/issues.jsonl` after changes (5s debounce)
- Imports from JSONL when newer (e.g., after `git pull`)
- No manual export/import needed!

#### MCP Server (Recommended)

If using Claude or MCP-compatible clients, install the beads MCP server:

```bash
pip install beads-mcp
```

Add to MCP config (e.g., `~/.config/claude/config.json`):
```json
{
  "beads": {
    "command": "beads-mcp",
    "args": []
  }
}
```

Then use `mcp__beads__*` functions instead of CLI commands.

#### Managing AI-Generated Planning Documents

AI assistants often create planning and design documents during development:
- PLAN.md, IMPLEMENTATION.md, ARCHITECTURE.MD
- DESIGN.md, CODEBASE_SUMMARY.md, INTEGRATION_PLAN.md
- TESTING_GUIDE.md, TECHNICAL_DESIGN.md, and similar files

**Best Practice: Use a dedicated directory for these ephemeral files**

**Recommended approach:**
- Create a `history/` directory in the project root
- Store ALL AI-generated planning/design docs in `history/`
- Keep the repository root clean and focused on permanent project files
- Only access `history/` when explicitly asked to review past planning

**Example .gitignore entry (optional):**
```text
# AI planning documents (ephemeral)
history/
```

**Benefits:**
- ✅ Clean repository root
- ✅ Clear separation between ephemeral and permanent documentation
- ✅ Easy to exclude from version control if desired
- ✅ Preserves planning history for archeological research
- ✅ Reduces noise when browsing the project

#### Important Rules

- ✅ Use bd for ALL task tracking (when `.beads` directory exists)
- ✅ Always use epics for large projects spanning multiple sessions
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ✅ Store AI planning docs in `history/` directory
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems
- ❌ Do NOT clutter repo root with planning documents

### Commit Convention

Use conventional commit format:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `chore:` - Maintenance
- `build:` - Build system
- `test:` - Tests

Always include footer:
```text
🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

## Architecture

### Database Schema

SQLite database with:
- `insights` table - Main storage
- `insights_fts` table - FTS5 full-text search
- Triggers to keep FTS index in sync
- Indexes on `context` and `created_at`

### MCP Tools (6 total)

1. **save-insight** - Save new insight
2. **search-insights** - Full-text search with FTS5
3. **list-insights** - List insights chronologically
4. **get-insight** - Retrieve by ID
5. **update-insight** - Update content/metadata
6. **delete-insight** - Delete by ID

### Context Isolation

- **Stdio mode:** Auto-detects CWD, optional override
- **HTTP mode:** Requires explicit context parameter (no default)
- **Global context:** Use `"global"` string for cross-project insights

## Implementation Status

**Current Phase:** Implementation

See `docs/plans/2025-11-25-implement-mcp-server.md` for detailed implementation plan.

## Testing Strategy

- Manual testing during development
- Test both stdio and HTTP modes
- Verify all 6 tools work correctly
- Test FTS5 search with various queries
- Test pagination with large datasets
- Test context isolation

## Common Issues

### Build Errors

Make sure TypeScript is configured for ES2022 modules:
- `"type": "module"` in package.json
- `"module": "ES2022"` in tsconfig.json
- Use `.js` extensions in imports

### Database Location

Default: `~/.insights-mcp/insights.db`

Override with:
- `--db-path` flag
- `INSIGHTS_MCP_DB_PATH` environment variable

### HTTP Mode Context

HTTP mode requires explicit context parameter on all tools. This prevents accidental pollution of global context.

## Resources

- [Design Document](docs/plans/2025-11-25-insights-mcp-design.md)
- [Implementation Plan](docs/plans/2025-11-25-implement-mcp-server.md)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [better-sqlite3 Docs](https://github.com/WiseLibs/better-sqlite3)

## Notes

- This file will be updated as implementation progresses
- Keep documentation in sync with code changes
- Use bd for task tracking, not TodoWrite
- Store planning docs in `history/` directory (not implemented yet)
