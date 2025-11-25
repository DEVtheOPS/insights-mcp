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

  delete(id: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM insights WHERE id = ?
    `);

    const result = stmt.run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
