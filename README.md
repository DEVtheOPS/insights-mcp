# insights-mcp

![CI](https://github.com/digitalfiz/insights-mcp/actions/workflows/test.yml/badge.svg)

MCP server for persistent memory storage in Claude Code sessions. Save and retrieve project-specific insights across sessions with full-text search.

## Features
- Persistent SQLite storage with FTS5 full-text search
- Project-specific or global context isolation
- Dual transport modes: stdio (local) and HTTP (remote)
- Six MCP tools: save, search, list, get, update, delete
- Flexible JSON metadata on each insight

## Installation
```bash
npm install -g insights-mcp
# or use npx without global install
npx insights-mcp --mode stdio
```

## Usage
### Stdio Mode (local / Claude Code)
```bash
insights-mcp
# or explicitly
insights-mcp --mode stdio --db-path ~/.insights-mcp/insights.db
```

### HTTP Mode (remote)
```bash
insights-mcp --mode http --port 3000
```
Server listens at `http://localhost:3000/mcp`.

### Configuration
- `--mode <stdio|http>`: Transport mode (default: stdio)
- `--db-path <path>`: Database file path (default: `~/.insights-mcp/insights.db`)
- `--port <number>`: HTTP port for http mode (default: 3000)

Environment variables mirror the flags:
- `INSIGHTS_MCP_MODE`
- `INSIGHTS_MCP_DB_PATH`
- `INSIGHTS_MCP_PORT`

CLI flags override environment variables.

## MCP Tools
- **save-insight**: Save new insight. Inputs: `content` (min 3 chars), `context` (required in HTTP), optional `metadata`. Output: `id`, `created_at`.
- **search-insights**: Full-text search with optional `context`, `limit`, `offset`. Output: `results`, `total`, `hasMore`.
- **list-insights**: List insights chronologically with optional `context`, `limit`, `offset`. Output: `results`, `total`, `hasMore`.
- **get-insight**: Retrieve by `id`. Output: `insight`, `found`.
- **update-insight**: Update `content` or `metadata` by `id`. Output: `updated`, `insight`.
- **delete-insight**: Delete by `id`. Output: `deleted`, `id`.

## Development
```bash
npm install
npm run build     # compile to dist/
npm run dev       # watch mode
npm start         # run compiled stdio mode
node dist/index.js --mode http --port 3000
```

## Database
- Default location: `~/.insights-mcp/insights.db` (override with `--db-path` or `INSIGHTS_MCP_DB_PATH`)
- Schema: `insights` table + `insights_fts` virtual table (FTS5) with triggers to keep indexes in sync
- Indexes on `context` and `created_at` for fast queries

## Claude Code integration
Example MCP client entry:
```json
{
  "mcpServers": {
    "insights": {
      "command": "npx",
      "args": ["insights-mcp"],
      "env": {
        "INSIGHTS_MCP_DB_PATH": "/path/to/custom/insights.db"
      }
    }
  }
}
```

## Contributing
- See `CONTRIBUTING.md` for workflow, coding guidelines, and commit format.
- All work is tracked with bd (beads); please create or link issues before sending a PR.

## License
GPL-3.0-only
