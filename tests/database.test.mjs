import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InsightsDatabase } from '../dist/database.js';

const makeDb = () => {
  const dir = mkdtempSync(join(tmpdir(), 'insights-db-'));
  const dbPath = join(dir, 'insights.db');
  const db = new InsightsDatabase(dbPath);
  return { db, dir, dbPath };
};

test('database CRUD and search', () => {
  const { db, dir } = makeDb();

  const a = db.save('hello world', 'ctx1', { tag: 'a' });
  const b = db.save('another entry', 'ctx1', { tag: 'b' });

  assert.equal(db.get(a.id)?.content, 'hello world');

  const updated = db.update(a.id, { content: 'updated content' });
  assert.equal(updated?.content, 'updated content');

  const list = db.list('ctx1', 10, 0);
  assert.equal(list.total, 2);
  assert.equal(list.results.length, 2);

  const search = db.search('updated', 'ctx1', 10, 0);
  assert.equal(search.total, 1);
  assert.equal(search.results[0].id, a.id);

  assert.ok(db.delete(a.id));
  assert.ok(!db.delete(a.id)); // idempotent delete returns false

  const listAfter = db.list('ctx1', 10, 0);
  assert.equal(listAfter.total, 1);
  assert.equal(listAfter.results[0].id, b.id);

  db.close();
  rmSync(dir, { recursive: true, force: true });
});
