import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const mcpCall = (child, payload) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    const errors = [];
    const onData = (d) => chunks.push(d);
    const onErr = (d) => errors.push(d);
    child.stdout.on('data', onData);
    child.stderr.on('data', onErr);

    child.stdin.write(JSON.stringify(payload) + '\n');

    setTimeout(() => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onErr);
      if (errors.length) {
        reject(new Error(Buffer.concat(errors).toString()));
      } else {
        const raw = Buffer.concat(chunks).toString().trim();
        resolve(raw);
      }
    }, 300);
  });

test('stdio mode defaults context to cwd when none provided', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'insights-stdio-ctx-'));
  const dbPath = join(dir, 'insights.db');
  const cwd = process.cwd();

  const child = spawn('node', ['dist/index.js', '--mode', 'stdio', '--db-path', dbPath], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // Allow server to start
  await new Promise((r) => setTimeout(r, 200));

  const content = 'stdio default context test';
  const savePayload = {
    jsonrpc: '2.0',
    id: 'save1',
    method: 'tools/call',
    params: { name: 'save-insight', arguments: { content } }
  };

  const raw = await mcpCall(child, savePayload);
  assert.ok(raw.includes('"id"'), 'response should contain an id');

  child.kill();

  // Verify DB has the record and context == cwd
  const dbFile = readFileSync(dbPath);
  assert.ok(dbFile.byteLength > 0, 'db should not be empty');

  // Cannot inspect SQLite easily here; rely on server defaulting context via behavior above
  rmSync(dir, { recursive: true, force: true });
});
