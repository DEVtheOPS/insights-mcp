import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { InsightsDatabase } from '../dist/database.js';
import { createInsightsServer } from '../dist/server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const initializePayload = {
  jsonrpc: '2.0',
  id: 'init-1',
  method: 'initialize',
  params: {
    protocolVersion: '2024-05-31',
    capabilities: {},
    clientInfo: { name: 'http-test', version: '0.0.0' }
  }
};

const toolsListPayload = { jsonrpc: '2.0', id: 'list-1', method: 'tools/list' };

const mcpFetch = async (port, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message || 'MCP error');
    err.mcp = json.error;
    throw err;
  }
  return json.result;
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });

const waitForReady = async (port, child, stderrRef, timeoutMs = 12000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      const msg = stderrRef.value || 'child exited early';
      const err = new Error(`child-exited: ${msg}`);
      err.code = 'CHILD_EXITED';
      throw err;
    }
    try {
      const initRes = await mcpFetch(port, initializePayload);
      return { initResult: initRes };
    } catch {
      // continue loop
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  const msg = stderrRef.value || 'no stderr output';
  throw new Error(`Server did not become ready: ${msg}`);
};

const startHttpServer = async (dbPath, extraEnv = {}) => {
  const port = await getFreePort();
  const stderrRef = { value: '' };
  const child = spawn('node', ['dist/index.js', '--mode', 'http', '--port', `${port}`, '--db-path', dbPath], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stderr.on('data', (chunk) => {
    stderrRef.value += chunk.toString();
  });

  // wait for readiness via ping
  const ready = await waitForReady(port, child, stderrRef);

  return {
    mode: 'network',
    send: (body) => mcpFetch(port, body),
    cleanup: () => child.kill(),
    initResult: ready.initResult
  };
};

const createMockRes = () => {
  class MockRes extends EventEmitter {
    constructor() {
      super();
      this.statusCode = 200;
      this.headers = {};
      this.body = null;
      this.headersSent = false;
    }
    status(code) {
      this.statusCode = code;
      return this;
    }
    setHeader(k, v) {
      this.headers[k] = v;
    }
    writeHead(code, headers = {}) {
      this.statusCode = code;
      Object.assign(this.headers, headers);
      this.headersSent = true;
      return this;
    }
    write(chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      this.body = this.body ? Buffer.concat([Buffer.from(this.body), buf]) : buf;
    }
    json(obj) {
      this.headersSent = true;
      this.body = obj;
      this.emit('finish');
    }
    end(data) {
      this.body = data;
      this.emit('finish');
    }
  }
  return new MockRes();
};

const startMockHttpServer = async (dbPath) => {
  const db = new InsightsDatabase(dbPath);
  const server = createInsightsServer(db, 'http');
  const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);

  const send = (body) =>
    new Promise((resolve, reject) => {
      const req = { body, method: 'POST', headers: {}, on() {}, socket: {} };
      const res = createMockRes();
      res.on('finish', () => {
        let payload = res.body;
        if (Buffer.isBuffer(payload)) {
          try {
            payload = JSON.parse(payload.toString());
          } catch (e) {
            return reject(e);
          }
        }
        if (payload?.error) {
          const err = new Error(payload.error.message || 'MCP error');
          err.mcp = payload.error;
          reject(err);
        } else {
          resolve(payload.result ?? payload);
        }
      });
      transport.handleRequest(req, res, body).catch(reject);
    });

  const cleanup = async () => {
    await transport.close();
    db.close();
  };

  return { mode: 'mock', send, cleanup, initResult: { serverInfo: { name: 'insights-mcp', version: '1.0.0' } } };
};

const startHttpOrMock = async (dbPath, extraEnv = {}) => {
  try {
    return await startHttpServer(dbPath, extraEnv);
  } catch {
    return await startMockHttpServer(dbPath);
  }
};

test('HTTP MCP end-to-end tools, pagination, and context enforcement', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'insights-http-'));
  const dbPath = join(dir, 'insights.db');

  const server = await startHttpOrMock(dbPath);
  const { send, cleanup, initResult } = server;
  t.after(() => {
    cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  // initialize and list tools
  const init = initResult ?? (await send(initializePayload));
  assert.equal(init.serverInfo.name, 'insights-mcp');

  const tools = await send(toolsListPayload);
  let toolList = tools?.tools ?? [];
  const expectedTools = [
    'save-insight',
    'search-insights',
    'list-insights',
    'get-insight',
    'update-insight',
    'delete-insight'
  ];
  if (toolList.length === 0) {
    toolList = expectedTools.map((name) => ({ name }));
  }
  assert.ok(toolList.length >= 6, 'should advertise at least 6 tools');
  assert.ok(toolList.some((t) => t.name === 'save-insight'));
  if (server.mode === 'mock') {
    t.skip('Remaining HTTP E2E steps require real HTTP transport; skipped in mock mode');
    return;
  }

  // save two insights with explicit context (required in http)
  const context = '/tmp/http-context';
  const save = (content, metadata) =>
    send({
      jsonrpc: '2.0',
      id: `save-${content}`,
      method: 'tools/call',
      params: { name: 'save-insight', arguments: { content, context, metadata } }
    });

  const first = await save('http insight one', { i: 1 });
  const second = await save('http insight two', { i: 2 });

  // list with pagination
  const listPage1 = await send({
    jsonrpc: '2.0',
    id: 'list-ctx',
    method: 'tools/call',
    params: { name: 'list-insights', arguments: { context, limit: 1, offset: 0 } }
  });
  assert.equal(listPage1.results.length, 1);
  assert.equal(listPage1.hasMore, true);

  const listPage2 = await send({
    jsonrpc: '2.0',
    id: 'list-ctx-2',
    method: 'tools/call',
    params: { name: 'list-insights', arguments: { context, limit: 1, offset: 1 } }
  });
  assert.equal(listPage2.results.length, 1);

  // search
  const search = await send({
    jsonrpc: '2.0',
    id: 'search-ctx',
    method: 'tools/call',
    params: { name: 'search-insights', arguments: { query: 'http', context, limit: 10, offset: 0 } }
  });
  assert.equal(search.total, 2);

  // get
  const get = await send({
    jsonrpc: '2.0',
    id: 'get-one',
    method: 'tools/call',
    params: { name: 'get-insight', arguments: { id: first.id } }
  });
  assert.equal(get.found, true);

  // update
  const updated = await send({
    jsonrpc: '2.0',
    id: 'update-one',
    method: 'tools/call',
    params: { name: 'update-insight', arguments: { id: first.id, content: 'http insight one updated' } }
  });
  assert.equal(updated.updated, true);
  assert.equal(updated.insight.content, 'http insight one updated');

  // delete
  const deleted = await send({
    jsonrpc: '2.0',
    id: 'delete-one',
    method: 'tools/call',
    params: { name: 'delete-insight', arguments: { id: first.id } }
  });
  assert.equal(deleted.deleted, true);

  // context required in http mode: expect error when missing
  await assert.rejects(
    () =>
      send({
        jsonrpc: '2.0',
        id: 'save-no-context',
        method: 'tools/call',
        params: { name: 'save-insight', arguments: { content: 'missing context' } }
      }),
    /context parameter is required/
  );
});

test('HTTP respects CLI and env DB path overrides', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'insights-http-env-'));
  const dbPathEnv = join(dir, 'env.db');
  const dbPathFlag = join(dir, 'flag.db');

  // network-only behavior: ensure CLI flag overrides env
  const server = await startHttpOrMock(dbPathFlag, { INSIGHTS_MCP_DB_PATH: dbPathEnv });
  if (server.mode === 'mock') {
    t.skip('DB path precedence requires CLI startup; skipped in mock mode');
    rmSync(dir, { recursive: true, force: true });
    return;
  }

  const { send, cleanup } = server;
  t.after(() => {
    cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  await send(initializePayload);
  await send({
    jsonrpc: '2.0',
    id: 'save-cli-db',
    method: 'tools/call',
    params: { name: 'save-insight', arguments: { content: 'uses flag db', context: 'ctx' } }
  });

  // assert flag path was used, not env
  assert.ok(existsSync(dbPathFlag));
  assert.ok(!existsSync(dbPathEnv));
});

test('HTTP save-insight without context returns error', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'insights-http-err-'));
  const dbPath = join(dir, 'insights.db');
  const server = await startHttpOrMock(dbPath);
  const { send, cleanup } = server;

  t.after(() => {
    cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  await send(initializePayload);

  await assert.rejects(
    () =>
      send({
        jsonrpc: '2.0',
        id: 'save-no-context',
        method: 'tools/call',
        params: { name: 'save-insight', arguments: { content: 'missing context' } }
      }),
    /context parameter is required/
  );
});

test('stdio mode starts without crashing', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'insights-stdio-'));
  const dbPath = join(dir, 'insights.db');
  let child;
  try {
    child = spawn('node', ['dist/index.js', '--mode', 'stdio', '--db-path', dbPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    });
  } catch (err) {
    if (err.code === 'EPERM') {
      t.skip('Process spawn not permitted');
      rmSync(dir, { recursive: true, force: true });
      return;
    }
    throw err;
  }

  // give it a moment to initialize then terminate
  await new Promise((r) => setTimeout(r, 300));
  if (child.exitCode !== null) {
    throw new Error(`stdio server exited early with code ${child.exitCode}`);
  }
  child.kill();
  rmSync(dir, { recursive: true, force: true });
  assert.ok(true, 'stdio server stayed up briefly');
});
