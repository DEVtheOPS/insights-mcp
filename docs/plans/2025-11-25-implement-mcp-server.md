# Insights MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a production-ready MCP server enabling persistent memory storage for Claude Code sessions with full CRUD operations, full-text search, and dual transport modes (stdio/HTTP).

**Architecture:** SQLite database with FTS5 full-text search, TypeScript MCP server using official SDK, CLI interface with mode selection for stdio (local) or HTTP (remote) transports, context-aware storage (project-specific or global).

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, better-sqlite3, zod, commander, express

---

## Task 1: TypeScript Types and Interfaces

**Files:**
- Create: `src/types.ts`

**Step 1: Create types file with Insight interface**

Create `src/types.ts`:

```typescript
export interface Insight {
  id: string;                    // UUID v4
  content: string;               // Min 3 characters
  context: string;               // Absolute path or 'global'
  metadata?: Record<string, any>; // Flexible JSON metadata
  created_at: number;            // Unix timestamp
  updated_at: number;            // Unix timestamp
}

export interface SearchResult {
  results: Insight[];
  total: number;
  hasMore: boolean;
}

export interface TransportMode {
  mode: 'stdio' | 'http';
  port?: number;
  dbPath: string;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add TypeScript interfaces for Insight and config"
```

---

## Task 2: Database Module - Schema Setup

**Files:**
- Create: `src/database.ts`

**Step 1: Create database class with schema initialization**

Create `src/database.ts`:

```typescript
import Database from 'better-sqlite3';
import { Insight } from './types.js';
import { randomUUID } from 'crypto';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

export class InsightsDatabase {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const path = dbPath || join(homedir(), '.insights-mcp', 'insights.db');

    // Ensure directory exists
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(path);
    this.initSchema();
  }

  private initSchema(): void {
    // Create main table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS insights (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        context TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_context ON insights(context);
      CREATE INDEX IF NOT EXISTS idx_created_at ON insights(created_at);
    `);

    // Create FTS5 table
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS insights_fts USING fts5(
        content,
        metadata,
        content='insights',
        content_rowid='rowid'
      );
    `);

    // Create triggers for FTS sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS insights_ai AFTER INSERT ON insights BEGIN
        INSERT INTO insights_fts(rowid, content, metadata)
        VALUES (new.rowid, new.content, new.metadata);
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS insights_ad AFTER DELETE ON insights BEGIN
        DELETE FROM insights_fts WHERE rowid = old.rowid;
      END;
    `);

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS insights_au AFTER UPDATE ON insights BEGIN
        UPDATE insights_fts
        SET content = new.content, metadata = new.metadata
        WHERE rowid = new.rowid;
      END;
    `);
  }

  close(): void {
    this.db.close();
  }
}
```

**Step 2: Commit**

```bash
git add src/database.ts
git commit -m "feat: add database class with schema and FTS5 setup"
```

---

## Task 3: Database Module - CRUD Operations

**Files:**
- Modify: `src/database.ts`

**Step 1: Add save method**

Add to `InsightsDatabase` class in `src/database.ts`:

```typescript
  save(content: string, context: string, metadata?: Record<string, any>): Insight {
    const id = randomUUID();
    const now = Date.now();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      INSERT INTO insights (id, content, context, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, content, context, metadataJson, now, now);

    return {
      id,
      content,
      context,
      metadata,
      created_at: now,
      updated_at: now
    };
  }
```

**Step 2: Add get method**

Add to `InsightsDatabase` class:

```typescript
  get(id: string): Insight | null {
    const stmt = this.db.prepare(`
      SELECT * FROM insights WHERE id = ?
    `);

    const row = stmt.get(id) as any;
    if (!row) return null;

    return this.rowToInsight(row);
  }

  private rowToInsight(row: any): Insight {
    return {
      id: row.id,
      content: row.content,
      context: row.context,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
```

**Step 3: Add update method**

Add to `InsightsDatabase` class:

```typescript
  update(id: string, updates: { content?: string; metadata?: Record<string, any> }): Insight | null {
    const existing = this.get(id);
    if (!existing) return null;

    const now = Date.now();
    const content = updates.content ?? existing.content;
    const metadata = updates.metadata ?? existing.metadata;
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    const stmt = this.db.prepare(`
      UPDATE insights
      SET content = ?, metadata = ?, updated_at = ?
      WHERE id = ?
    `);

    stmt.run(content, metadataJson, now, id);

    return {
      ...existing,
      content,
      metadata,
      updated_at: now
    };
  }
```

**Step 4: Add delete method**

Add to `InsightsDatabase` class:

```typescript
  delete(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM insights WHERE id = ?
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }
```

**Step 5: Commit**

```bash
git add src/database.ts
git commit -m "feat: add CRUD operations to database"
```

---

## Task 4: Database Module - Search and List

**Files:**
- Modify: `src/database.ts`
- Modify: `src/types.ts`

**Step 1: Add list method**

Add to `InsightsDatabase` class in `src/database.ts`:

```typescript
  list(context?: string, limit: number = 20, offset: number = 0): { results: Insight[]; total: number; hasMore: boolean } {
    let query = 'SELECT * FROM insights';
    let countQuery = 'SELECT COUNT(*) as total FROM insights';
    const params: any[] = [];

    if (context) {
      query += ' WHERE context = ?';
      countQuery += ' WHERE context = ?';
      params.push(context);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';

    const totalResult = this.db.prepare(countQuery).get(...params) as { total: number };
    const total = totalResult.total;

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params, limit, offset) as any[];
    const results = rows.map(row => this.rowToInsight(row));

    return {
      results,
      total,
      hasMore: offset + results.length < total
    };
  }
```

**Step 2: Add search method with FTS5**

Add to `InsightsDatabase` class:

```typescript
  search(query: string, context?: string, limit: number = 20, offset: number = 0): { results: Insight[]; total: number; hasMore: boolean } {
    let sql = `
      SELECT insights.*, rank
      FROM insights_fts
      JOIN insights ON insights.rowid = insights_fts.rowid
      WHERE insights_fts MATCH ?
    `;
    const params: any[] = [query];

    if (context) {
      sql += ' AND insights.context = ?';
      params.push(context);
    }

    sql += ' ORDER BY rank LIMIT ? OFFSET ?';

    // Get total count
    let countSql = `
      SELECT COUNT(*) as total
      FROM insights_fts
      JOIN insights ON insights.rowid = insights_fts.rowid
      WHERE insights_fts MATCH ?
    `;
    const countParams: any[] = [query];

    if (context) {
      countSql += ' AND insights.context = ?';
      countParams.push(context);
    }

    const totalResult = this.db.prepare(countSql).get(...countParams) as { total: number };
    const total = totalResult.total;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params, limit, offset) as any[];
    const results = rows.map(row => this.rowToInsight(row));

    return {
      results,
      total,
      hasMore: offset + results.length < total
    };
  }
```

**Step 3: Commit**

```bash
git add src/database.ts
git commit -m "feat: add list and FTS5 search to database"
```

---

## Task 5: MCP Server - Tool Definitions

**Files:**
- Create: `src/server.ts`

**Step 1: Create server module with tool schemas**

Create `src/server.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { InsightsDatabase } from './database.js';
import { Insight } from './types.js';

export function createInsightsServer(db: InsightsDatabase, mode: 'stdio' | 'http'): McpServer {
  const server = new McpServer({
    name: 'insights-mcp',
    version: '1.0.0'
  });

  // Helper to get context with mode-aware validation
  const getContext = (providedContext?: string): string => {
    if (mode === 'http' && !providedContext) {
      throw new Error('context parameter is required in HTTP mode');
    }
    return providedContext || process.cwd();
  };

  // Define Insight schema for output
  const InsightSchema = z.object({
    id: z.string(),
    content: z.string(),
    context: z.string(),
    metadata: z.record(z.any()).optional(),
    created_at: z.number(),
    updated_at: z.number()
  });

  return server;
}
```

**Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: create MCP server module with context validation"
```

---

## Task 6: MCP Server - Save Insight Tool

**Files:**
- Modify: `src/server.ts`

**Step 1: Add save-insight tool**

Add to `createInsightsServer` function in `src/server.ts`, before the `return server;` line:

```typescript
  // Tool 1: save-insight
  server.registerTool(
    'save-insight',
    {
      title: 'Save Insight',
      description: 'Save a new insight to the database',
      inputSchema: {
        content: z.string().min(3).describe('The insight content'),
        context: z.string().optional().describe('Project path or "global". Required in HTTP mode.'),
        metadata: z.record(z.any()).optional().describe('Optional metadata as JSON object')
      },
      outputSchema: {
        id: z.string().describe('Generated insight ID (UUID)'),
        created_at: z.number().describe('Creation timestamp')
      }
    },
    async ({ content, context, metadata }) => {
      const resolvedContext = getContext(context);
      const insight = db.save(content, resolvedContext, metadata);

      const output = {
        id: insight.id,
        created_at: insight.created_at
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );
```

**Step 2: Commit**

```bash
git add src/server.ts
git commit -m "feat: add save-insight tool"
```

---

## Task 7: MCP Server - Search and List Tools

**Files:**
- Modify: `src/server.ts`

**Step 1: Add search-insights tool**

Add to `createInsightsServer` function in `src/server.ts`, before the `return server;` line:

```typescript
  // Tool 2: search-insights
  server.registerTool(
    'search-insights',
    {
      title: 'Search Insights',
      description: 'Full-text search for insights using FTS5',
      inputSchema: {
        query: z.string().min(3).describe('Search query'),
        context: z.string().optional().describe('Filter by context. Required in HTTP mode.'),
        limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
        offset: z.number().min(0).default(0).describe('Pagination offset')
      },
      outputSchema: {
        results: z.array(InsightSchema).describe('Matching insights'),
        total: z.number().describe('Total matching results'),
        hasMore: z.boolean().describe('Whether more results exist')
      }
    },
    async ({ query, context, limit, offset }) => {
      const resolvedContext = context ? getContext(context) : undefined;
      const output = db.search(query, resolvedContext, limit ?? 20, offset ?? 0);

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );
```

**Step 2: Add list-insights tool**

Add to `createInsightsServer` function:

```typescript
  // Tool 3: list-insights
  server.registerTool(
    'list-insights',
    {
      title: 'List Insights',
      description: 'List all insights for a context in chronological order',
      inputSchema: {
        context: z.string().optional().describe('Filter by context. Required in HTTP mode.'),
        limit: z.number().min(1).max(100).default(20).describe('Max results per page'),
        offset: z.number().min(0).default(0).describe('Pagination offset')
      },
      outputSchema: {
        results: z.array(InsightSchema).describe('Insights for context'),
        total: z.number().describe('Total insights in context'),
        hasMore: z.boolean().describe('Whether more results exist')
      }
    },
    async ({ context, limit, offset }) => {
      const resolvedContext = context ? getContext(context) : undefined;
      const output = db.list(resolvedContext, limit ?? 20, offset ?? 0);

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );
```

**Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add search-insights and list-insights tools"
```

---

## Task 8: MCP Server - Get, Update, Delete Tools

**Files:**
- Modify: `src/server.ts`

**Step 1: Add get-insight tool**

Add to `createInsightsServer` function in `src/server.ts`:

```typescript
  // Tool 4: get-insight
  server.registerTool(
    'get-insight',
    {
      title: 'Get Insight',
      description: 'Retrieve a specific insight by ID',
      inputSchema: {
        id: z.string().uuid().describe('Insight ID')
      },
      outputSchema: {
        insight: InsightSchema.optional().describe('The insight if found'),
        found: z.boolean().describe('Whether insight exists')
      }
    },
    async ({ id }) => {
      const insight = db.get(id);
      const output = {
        insight: insight || undefined,
        found: insight !== null
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );
```

**Step 2: Add update-insight tool**

Add to `createInsightsServer` function:

```typescript
  // Tool 5: update-insight
  server.registerTool(
    'update-insight',
    {
      title: 'Update Insight',
      description: "Update an existing insight's content or metadata",
      inputSchema: {
        id: z.string().uuid().describe('Insight ID'),
        content: z.string().min(3).optional().describe('New content'),
        metadata: z.record(z.any()).optional().describe('New metadata (replaces existing)')
      },
      outputSchema: {
        updated: z.boolean().describe('Whether update succeeded'),
        insight: InsightSchema.optional().describe('Updated insight if found')
      }
    },
    async ({ id, content, metadata }) => {
      const insight = db.update(id, { content, metadata });
      const output = {
        updated: insight !== null,
        insight: insight || undefined
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );
```

**Step 3: Add delete-insight tool**

Add to `createInsightsServer` function:

```typescript
  // Tool 6: delete-insight
  server.registerTool(
    'delete-insight',
    {
      title: 'Delete Insight',
      description: 'Delete an insight by ID',
      inputSchema: {
        id: z.string().uuid().describe('Insight ID')
      },
      outputSchema: {
        deleted: z.boolean().describe('Whether deletion succeeded'),
        id: z.string().describe('The insight ID')
      }
    },
    async ({ id }) => {
      const deleted = db.delete(id);
      const output = {
        deleted,
        id
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        structuredContent: output
      };
    }
  );
```

**Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: add get, update, and delete insight tools"
```

---

## Task 9: Transport - Stdio Implementation

**Files:**
- Create: `src/transports/stdio.ts`

**Step 1: Create stdio transport module**

Create `src/transports/stdio.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export async function startStdioTransport(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    transport.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    transport.close();
    process.exit(0);
  });
}
```

**Step 2: Commit**

```bash
git add src/transports/stdio.ts
git commit -m "feat: add stdio transport implementation"
```

---

## Task 10: Transport - HTTP Implementation

**Files:**
- Create: `src/transports/http.ts`

**Step 1: Create HTTP transport module**

Create `src/transports/http.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

export async function startHttpTransport(server: McpServer, port: number): Promise<void> {
  const app = express();
  app.use(express.json());

  app.post('/mcp', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });

      res.on('close', () => {
        transport.close();
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error'
          },
          id: null
        });
      }
    }
  });

  const httpServer = app.listen(port, () => {
    console.log(`MCP Server running on http://localhost:${port}/mcp`);
  });

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    httpServer.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    httpServer.close();
    process.exit(0);
  });
}
```

**Step 2: Commit**

```bash
git add src/transports/http.ts
git commit -m "feat: add HTTP transport implementation"
```

---

## Task 11: CLI Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Create CLI with commander**

Create `src/index.ts`:

```typescript
#!/usr/bin/env node

import { Command } from 'commander';
import { InsightsDatabase } from './database.js';
import { createInsightsServer } from './server.js';
import { startStdioTransport } from './transports/stdio.js';
import { startHttpTransport } from './transports/http.js';

const program = new Command();

program
  .name('insights-mcp')
  .description('MCP server for persistent memory storage in Claude Code sessions')
  .version('1.0.0')
  .option('--mode <mode>', 'Transport mode (stdio|http)', process.env.INSIGHTS_MCP_MODE || 'stdio')
  .option('--db-path <path>', 'Database file path', process.env.INSIGHTS_MCP_DB_PATH)
  .option('--port <number>', 'HTTP port (only for http mode)', process.env.INSIGHTS_MCP_PORT || '3000')
  .action(async (options) => {
    const mode = options.mode as 'stdio' | 'http';

    if (mode !== 'stdio' && mode !== 'http') {
      console.error('Error: --mode must be either "stdio" or "http"');
      process.exit(1);
    }

    try {
      // Initialize database
      const db = new InsightsDatabase(options.dbPath);

      // Create MCP server
      const server = createInsightsServer(db, mode);

      // Start appropriate transport
      if (mode === 'stdio') {
        await startStdioTransport(server);
      } else {
        const port = parseInt(options.port, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          console.error('Error: --port must be a valid port number (1-65535)');
          process.exit(1);
        }
        await startHttpTransport(server, port);
      }
    } catch (error) {
      console.error('Error starting server:', error);
      process.exit(1);
    }
  });

program.parse();
```

**Step 2: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry point with mode selection"
```

---

## Task 12: Build and Test

**Files:**
- None (build verification)

**Step 1: Build TypeScript**

Run: `npm run build`

Expected: Success, `dist/` directory created with compiled JS files

**Step 2: Verify dist output**

Run: `ls -la dist/`

Expected: See `index.js`, `server.js`, `database.js`, `types.js`, `transports/` directory with `.js`, `.d.ts`, and `.js.map` files

**Step 3: Check executable has shebang**

Run: `head -1 dist/index.js`

Expected: `#!/usr/bin/env node`

**Step 4: Make executable**

Run: `chmod +x dist/index.js`

**Step 5: Test CLI help**

Run: `node dist/index.js --help`

Expected: Shows help text with options (--mode, --db-path, --port)

**Step 6: Commit**

```bash
git add .
git commit -m "build: compile TypeScript and verify output"
```

---

## Task 13: Create README

**Files:**
- Create: `README.md`

**Step 1: Create comprehensive README**

Create `README.md`:

```markdown
# insights-mcp

MCP server for persistent memory storage in Claude Code sessions. Allows Claude to save and retrieve project-specific insights across sessions with full-text search.

## Features

- 💾 Persistent SQLite storage with FTS5 full-text search
- 🔍 Project-specific or global context isolation
- 🔌 Dual transport modes: stdio (local) and HTTP (remote)
- 🛠️ 6 MCP tools: save, search, list, get, update, delete
- 📄 Flexible metadata support for rich context
- ⚡ Fast pagination for large result sets

## Installation

```bash
npm install -g insights-mcp
```

Or use directly with npx:

```bash
npx insights-mcp --mode stdio
```

## Usage

### Stdio Mode (Local/Claude Code)

Start the server for local MCP clients:

```bash
insights-mcp
# or explicitly
insights-mcp --mode stdio --db-path ~/.insights-mcp/insights.db
```

### HTTP Mode (Remote)

Start the HTTP server:

```bash
insights-mcp --mode http --port 3000
```

Server runs at `http://localhost:3000/mcp`

### Configuration

**CLI Flags:**
- `--mode <stdio|http>` - Transport mode (default: stdio)
- `--db-path <path>` - Database file path (default: `~/.insights-mcp/insights.db`)
- `--port <number>` - HTTP port, only for http mode (default: 3000)

**Environment Variables:**
- `INSIGHTS_MCP_MODE` - Same as `--mode`
- `INSIGHTS_MCP_DB_PATH` - Same as `--db-path`
- `INSIGHTS_MCP_PORT` - Same as `--port`

Priority: CLI flags > environment variables > defaults

## MCP Tools

### save-insight

Save a new insight to the database.

**Input:**
- `content` (string, min 3 chars) - The insight content
- `context` (string, optional) - Project path or "global" (required in HTTP mode)
- `metadata` (object, optional) - Optional metadata as JSON object

**Output:**
- `id` (string) - Generated UUID
- `created_at` (number) - Creation timestamp

### search-insights

Full-text search for insights using SQLite FTS5.

**Input:**
- `query` (string, min 3 chars) - Search query
- `context` (string, optional) - Filter by context (required in HTTP mode)
- `limit` (number, 1-100, default 20) - Max results per page
- `offset` (number, default 0) - Pagination offset

**Output:**
- `results` (array) - Matching insights
- `total` (number) - Total matching results
- `hasMore` (boolean) - Whether more results exist

### list-insights

List all insights for a context in chronological order.

**Input:**
- `context` (string, optional) - Filter by context (required in HTTP mode)
- `limit` (number, 1-100, default 20) - Max results per page
- `offset` (number, default 0) - Pagination offset

**Output:** Same as search-insights

### get-insight

Retrieve a specific insight by ID.

**Input:**
- `id` (string, UUID) - Insight ID

**Output:**
- `insight` (object, optional) - The insight if found
- `found` (boolean) - Whether insight exists

### update-insight

Update an existing insight's content or metadata.

**Input:**
- `id` (string, UUID) - Insight ID
- `content` (string, min 3 chars, optional) - New content
- `metadata` (object, optional) - New metadata (replaces existing)

**Output:**
- `updated` (boolean) - Whether update succeeded
- `insight` (object, optional) - Updated insight if found

### delete-insight

Delete an insight by ID.

**Input:**
- `id` (string, UUID) - Insight ID

**Output:**
- `deleted` (boolean) - Whether deletion succeeded
- `id` (string) - The insight ID

## Claude Code Integration

Add to your Claude Code MCP settings (`.claude/settings.local.json` or global config):

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

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Development mode (watch)
npm run dev

# Start server
npm start
```

## Database

SQLite database with FTS5 full-text search index. Default location: `~/.insights-mcp/insights.db`

**Schema:**
- `insights` table - Main storage
- `insights_fts` table - FTS5 full-text search index
- Automatic triggers keep FTS index in sync
- Indexes on `context` and `created_at` for performance

## License

MIT
```text

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add comprehensive README"
```

---

## Task 14: Manual Testing

**Files:**
- None (manual testing)

**Step 1: Test stdio mode startup**

Run: `node dist/index.js --mode stdio`

Expected: Server starts, no errors, waiting for stdin

Press `Ctrl+C` to stop

**Step 2: Test HTTP mode startup**

Run: `node dist/index.js --mode http --port 3001`

Expected: Console shows "MCP Server running on http://localhost:3001/mcp"

Press `Ctrl+C` to stop

**Step 3: Test database creation**

Run: `node dist/index.js --mode stdio --db-path /tmp/test-insights.db`

Press `Ctrl+C` to stop

Run: `ls -la /tmp/test-insights.db`

Expected: Database file exists

Run: `sqlite3 /tmp/test-insights.db ".tables"`

Expected: Shows `insights`, `insights_fts`, and trigger tables

**Step 4: Clean up test database**

Run: `rm /tmp/test-insights.db*`

---

## Task 15: Final Package Verification

**Files:**
- Modify: `package.json` (if needed)

**Step 1: Verify package.json files field**

Check that `package.json` has:
```json
"files": ["dist"]
```

**Step 2: Test local installation**

Run: `npm pack`

Expected: Creates `insights-mcp-1.0.0.tgz`

Run: `tar -tzf insights-mcp-1.0.0.tgz | head -20`

Expected: Shows `package/dist/` files

**Step 3: Clean up**

Run: `rm insights-mcp-1.0.0.tgz`

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: finalize package for release"
```

---

## Success Criteria

Implementation complete when:

- ✅ All 6 tools registered and working
- ✅ Both stdio and HTTP modes functional
- ✅ Database schema created with FTS5
- ✅ Context validation enforces HTTP mode requirements
- ✅ CLI accepts flags and environment variables
- ✅ Build produces clean dist/ output
- ✅ Executable has proper shebang
- ✅ README documents all features
- ✅ Manual tests pass

## Next Steps After Implementation

1. Test with actual Claude Code session
2. Create example `.claude/settings.local.json` configuration
3. Test all 6 tools via Claude Code
4. Verify FTS5 search returns relevant results
5. Test pagination with large datasets
6. Consider publishing to npm

## Notes

- Use DRY principle: database operations are centralized
- YAGNI: No premature optimization or unused features
- TDD: Build would benefit from unit tests in future
- Frequent commits: Each task has clear commit point
- Error handling: Graceful failures with informative messages
