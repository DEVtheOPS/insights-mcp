# Insights MCP Server - Design Document

**Date:** 2025-11-25
**Status:** Approved for Implementation

## Overview

A Model Context Protocol (MCP) server that provides persistent memory storage for Claude Code sessions. Allows Claude to save and retrieve project-specific insights across sessions, with support for both stdio (local) and HTTP (remote) transports.

## Core Concept

Claude Code can save "insights" - important findings, patterns, decisions, or context about a project - that persist across sessions and context compactions. These insights are searchable and can be project-specific or global (cross-project).

## Architecture

### Package Structure

```bash
insights-mcp/
├── src/
│   ├── index.ts              # CLI entry point (mode selection, arg parsing)
│   ├── server.ts             # MCP server setup & tool registration
│   ├── database.ts           # SQLite database operations (CRUD + FTS5)
│   ├── transports/
│   │   ├── stdio.ts          # Stdio transport setup
│   │   └── http.ts           # HTTP transport setup
│   └── types.ts              # TypeScript interfaces for Insight, etc.
├── package.json
├── tsconfig.json
└── README.md
```

### Technology Stack

- **MCP SDK:** `@modelcontextprotocol/sdk` (official TypeScript SDK)
- **Database:** `better-sqlite3` with FTS5 full-text search
- **Validation:** `zod` for schema validation
- **CLI:** `commander` for argument parsing
- **HTTP:** `express` for HTTP transport mode
- **Build:** TypeScript compiled to dist/, executable via npx

## Data Model

### Database Schema

```sql
-- Main insights table
CREATE TABLE insights (
    id TEXT PRIMARY KEY,           -- UUID v4
    content TEXT NOT NULL,         -- The actual insight text (min 3 chars)
    context TEXT NOT NULL,         -- Project path or 'global'
    metadata TEXT,                 -- JSON blob for extensible metadata
    created_at INTEGER NOT NULL,   -- Unix timestamp
    updated_at INTEGER NOT NULL    -- Unix timestamp
);

-- Full-text search index (FTS5)
CREATE VIRTUAL TABLE insights_fts USING fts5(
    content,
    metadata,
    content='insights',
    content_rowid='rowid'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER insights_ai AFTER INSERT ON insights BEGIN
    INSERT INTO insights_fts(rowid, content, metadata)
    VALUES (new.rowid, new.content, new.metadata);
END;

CREATE TRIGGER insights_ad AFTER DELETE ON insights BEGIN
    DELETE FROM insights_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER insights_au AFTER UPDATE ON insights BEGIN
    UPDATE insights_fts
    SET content = new.content, metadata = new.metadata
    WHERE rowid = new.rowid;
END;

-- Indexes for efficient queries
CREATE INDEX idx_context ON insights(context);
CREATE INDEX idx_created_at ON insights(created_at);
```

### TypeScript Interface

```typescript
interface Insight {
    id: string;                    // UUID v4
    content: string;               // Min 3 characters
    context: string;               // Absolute path or 'global'
    metadata?: Record<string, any>; // Flexible JSON metadata
    created_at: number;            // Unix timestamp
    updated_at: number;            // Unix timestamp
}
```

### Context Handling

**Stdio Mode:**
- Auto-detects working directory from `process.cwd()`
- `context` parameter is optional, defaults to CWD
- Can explicitly override with 'global' or any path

**HTTP Mode:**
- `context` parameter is **required** (no default)
- Errors if omitted: "context parameter is required in HTTP mode"
- Must explicitly specify 'global' or project path
- Prevents accidental pollution of global context

## MCP Tools

### 1. save-insight

Save a new insight to the database.

**Input Schema:**
```typescript
{
    content: z.string().min(3).describe('The insight content'),
    context: z.string().optional().describe('Project path or "global". Required in HTTP mode.'),
    metadata: z.record(z.any()).optional().describe('Optional metadata as JSON object')
}
```

**Output Schema:**
```typescript
{
    id: z.string().describe('Generated insight ID (UUID)'),
    created_at: z.number().describe('Creation timestamp')
}
```

**Behavior:**
- Generates UUID v4 for id
- Validates content length (min 3 chars)
- Validates context requirement based on transport mode
- Saves to database with current timestamp
- Returns generated ID

### 2. search-insights

Full-text search for insights using SQLite FTS5.

**Input Schema:**
```typescript
{
    query: z.string().min(3).describe('Search query'),
    context: z.string().optional().describe('Filter by context. Required in HTTP mode.'),
    limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
    offset: z.number().min(0).default(0).describe('Pagination offset')
}
```

**Output Schema:**
```typescript
{
    results: z.array(InsightSchema).describe('Matching insights'),
    total: z.number().describe('Total matching results'),
    hasMore: z.boolean().describe('Whether more results exist')
}
```

**Behavior:**
- Uses FTS5 full-text search with ranking
- Filters by context if provided
- Returns paginated results ordered by relevance
- Includes total count and pagination indicator

### 3. list-insights

List all insights for a context in chronological order.

**Input Schema:**
```typescript
{
    context: z.string().optional().describe('Filter by context. Required in HTTP mode.'),
    limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
    offset: z.number().min(0).default(0).describe('Pagination offset')
}
```

**Output Schema:**
```typescript
{
    results: z.array(InsightSchema).describe('Insights for context'),
    total: z.number().describe('Total insights in context'),
    hasMore: z.boolean().describe('Whether more results exist')
}
```

**Behavior:**
- Returns insights ordered by `created_at DESC` (newest first)
- Filters by context if provided
- Supports pagination

### 4. get-insight

Retrieve a specific insight by ID.

**Input Schema:**
```typescript
{
    id: z.string().uuid().describe('Insight ID')
}
```

**Output Schema:**
```typescript
{
    insight: InsightSchema.optional().describe('The insight if found'),
    found: z.boolean().describe('Whether insight exists')
}
```

**Behavior:**
- Looks up insight by UUID
- Returns `found: false` if not exists
- No context filtering (IDs are globally unique)

### 5. delete-insight

Delete an insight by ID.

**Input Schema:**
```typescript
{
    id: z.string().uuid().describe('Insight ID')
}
```

**Output Schema:**
```typescript
{
    deleted: z.boolean().describe('Whether deletion succeeded'),
    id: z.string().describe('The insight ID')
}
```

**Behavior:**
- Removes insight from database
- Returns `deleted: false` if ID not found
- FTS5 index automatically updated via trigger

### 6. update-insight

Update an existing insight's content or metadata.

**Input Schema:**
```typescript
{
    id: z.string().uuid().describe('Insight ID'),
    content: z.string().min(3).optional().describe('New content'),
    metadata: z.record(z.any()).optional().describe('New metadata (replaces existing)')
}
```

**Output Schema:**
```typescript
{
    updated: z.boolean().describe('Whether update succeeded'),
    insight: InsightSchema.optional().describe('Updated insight if found')
}
```

**Behavior:**
- Updates only provided fields
- Updates `updated_at` timestamp
- Metadata replaces entire existing metadata (not merged)
- Returns `updated: false` if ID not found

## CLI Interface

### Command Structure

```bash
# Stdio mode (default)
npx insights-mcp
npx insights-mcp --mode stdio
npx insights-mcp --mode stdio --db-path /custom/path/insights.db

# HTTP mode
npx insights-mcp --mode http
npx insights-mcp --mode http --port 3000 --db-path /custom/path/insights.db
```

### CLI Flags

- `--mode <stdio|http>` - Transport mode (default: stdio)
- `--db-path <path>` - Database file path (default: `~/.insights-mcp/insights.db`)
- `--port <number>` - HTTP server port, only for http mode (default: 3000)

### Environment Variables

Environment variables provide defaults, but CLI flags take precedence.

- `INSIGHTS_MCP_MODE` - Same as `--mode`
- `INSIGHTS_MCP_DB_PATH` - Same as `--db-path`
- `INSIGHTS_MCP_PORT` - Same as `--port`

**Priority:** CLI flags > environment variables > built-in defaults

### Default Configuration

- **Mode:** stdio
- **Database Path:** `~/.insights-mcp/insights.db` (auto-detect OS home directory)
- **HTTP Port:** 3000 (only applicable in http mode)

## Implementation Details

### Database Initialization

- Auto-create database directory if doesn't exist
- Run schema creation SQL on first connection
- Validate database integrity on startup
- Gracefully handle permission errors

### Error Handling

**Validation Errors:**
- Return proper MCP error responses
- Include detailed validation messages from Zod

**Database Errors:**
- Catch and wrap SQLite errors
- Return user-friendly error messages
- Log technical details for debugging

**HTTP Mode:**
- Use JSON-RPC 2.0 error format
- Proper HTTP status codes (500 for internal errors)

**Stdio Mode:**
- Structured error responses via MCP protocol
- Exit cleanly on fatal errors

### TypeScript Build

- Compile TypeScript to `dist/` directory
- Include source maps for debugging
- Package includes compiled JS (not TS source)
- `bin` entry points to `dist/index.js` with `#!/usr/bin/env node` shebang
- Use `"type": "module"` for ES modules

### Package Configuration

**package.json key fields:**
```json
{
  "name": "insights-mcp",
  "version": "1.0.0",
  "type": "module",
  "bin": {
    "insights-mcp": "./dist/index.js"
  },
  "files": ["dist"],
  "engines": {
    "node": ">=18"
  }
}
```

## Usage Examples

### Claude Code (Stdio Mode)

Claude Code would configure the MCP server in its settings and automatically use it:

```typescript
// Claude Code calls tools via MCP protocol
await callTool('save-insight', {
    content: 'Auth uses JWT tokens stored in httpOnly cookies',
    metadata: {
        files: ['src/auth/middleware.ts'],
        category: 'authentication'
    }
    // context auto-detected from CWD
});

// Search for relevant insights
const results = await callTool('search-insights', {
    query: 'authentication token',
    limit: 10
});
```

### HTTP Mode (Remote Usage)

```bash
# Start HTTP server
npx insights-mcp --mode http --port 3000

# Client makes JSON-RPC requests to http://localhost:3000/mcp
```

## Future Enhancements

Potential features for future versions:

- **Bulk operations:** Import/export insights as JSON
- **Tags system:** Built-in tagging instead of metadata-only
- **Relationships:** Link related insights together
- **Expiry dates:** Auto-archive insights after certain time
- **Conflict resolution:** Merge insights from different sources
- **Encryption:** Encrypt sensitive insights at rest
- **Sync:** Multi-device synchronization

## Success Criteria

The implementation will be considered successful when:

1. ✅ Can be installed and run via `npx insights-mcp`
2. ✅ Works in both stdio and http modes
3. ✅ All 6 CRUD tools function correctly
4. ✅ Full-text search returns relevant results
5. ✅ Context isolation works properly (project vs global)
6. ✅ HTTP mode enforces context requirement
7. ✅ Database persists across sessions
8. ✅ Pagination works for large result sets
9. ✅ Compatible with Claude Code MCP integration
10. ✅ Clean error messages for common issues

## Testing Strategy

- **Unit tests:** Database operations, context detection
- **Integration tests:** Full tool workflow (save -> search -> get -> delete)
- **Manual testing:** Test with actual Claude Code session
- **HTTP testing:** Test HTTP mode with multiple clients
- **Edge cases:** Empty database, invalid UUIDs, context validation
