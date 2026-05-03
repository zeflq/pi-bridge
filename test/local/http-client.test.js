import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { httpGet, httpPost, _withRetry, _MAX_RETRIES } = require('../../src/local/http-client.js');

const TOKEN = 'test-token-for-http-client';
let serverProcess;
let port;

// Server script that runs in a child process (avoids event-loop deadlock
// caused by execFileSync blocking the parent while the server waits for requests)
const SERVER_SCRIPT = `
const http = require('http');
const TOKEN = ${JSON.stringify(TOKEN)};
let lastRequest = null;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.headers['x-token'] !== TOKEN) {
      res.writeHead(401); res.end('Unauthorized'); return;
    }
    const body = Buffer.concat(chunks).toString('utf8');
    if (url.pathname === '/list') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(['a.txt', 'b.txt']));
      return;
    }
    if (url.pathname === '/echo') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(body);
      return;
    }
    res.writeHead(200); res.end('ok');
  });
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write('PORT:' + server.address().port + '\\n');
});
`;

beforeAll(async () => {
  // Start the server as a fully independent child process
  serverProcess = spawn(process.execPath, ['-e', SERVER_SCRIPT], {
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  port = await new Promise((resolve, reject) => {
    let buf = '';
    serverProcess.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/PORT:(\d+)/);
      if (m) resolve(parseInt(m[1], 10));
    });
    serverProcess.on('error', reject);
    setTimeout(() => reject(new Error('server did not start in time')), 5000);
  });
});

afterAll(() => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

describe('http-client.js', () => {
  describe('httpGet()', () => {
    it('attaches x-token header and returns response body', () => {
      const body = httpGet(port, TOKEN, '/list');
      expect(JSON.parse(body)).toEqual(['a.txt', 'b.txt']);
    });

    it('sends request to the correct path', () => {
      // The echo endpoint mirrors the body; for GET we check the path via list
      const body = httpGet(port, TOKEN, '/list?path=%2Froot%2Fproject');
      expect(JSON.parse(body)).toEqual(['a.txt', 'b.txt']);
    });

    it('throws on 401 (wrong token)', () => {
      expect(() => httpGet(port, 'wrong-token', '/list')).toThrow();
    });
  });

  describe('httpPost()', () => {
    it('sends body content and returns response', () => {
      const result = httpPost(port, TOKEN, '/echo', 'my-content');
      expect(result).toBe('my-content');
    });

    it('sends request to the correct path', () => {
      const result = httpPost(port, TOKEN, '/echo', 'path-check');
      expect(result).toBe('path-check');
    });

    it('throws on 401 (wrong token)', () => {
      expect(() => httpPost(port, 'bad-token', '/echo', 'x')).toThrow();
    });
  });
});

// ── withRetry ────────────────────────────────────────────────────────────────

describe('withRetry()', () => {
  const noop = () => {};
  const connRefused = (msg = 'connect ECONNREFUSED 127.0.0.1:9') =>
    JSON.stringify({ ok: false, status: 0, body: msg });
  const success = (body = 'ok') =>
    JSON.stringify({ ok: true, status: 200, body });

  it('returns immediately when fn succeeds on first attempt', () => {
    let calls = 0;
    const raw = _withRetry(() => { calls++; return success(); }, noop);
    expect(JSON.parse(raw).body).toBe('ok');
    expect(calls).toBe(1);
  });

  it('retries on ECONNREFUSED and returns first success', () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return calls < 3 ? connRefused() : success('recovered');
    };
    const raw = _withRetry(fn, noop);
    expect(JSON.parse(raw).body).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('calls sleep between retries', () => {
    let sleeps = 0;
    let calls = 0;
    const fn = () => { calls++; return calls < 3 ? connRefused() : success(); };
    _withRetry(fn, () => sleeps++);
    expect(sleeps).toBe(2);
  });

  it('stops after MAX_RETRIES and returns the last ECONNREFUSED result', () => {
    let calls = 0;
    const raw = _withRetry(() => { calls++; return connRefused(); }, noop);
    expect(calls).toBe(_MAX_RETRIES + 1);
    expect(JSON.parse(raw).ok).toBe(false);
  });

  it('does not retry on non-ECONNREFUSED errors (e.g. 401)', () => {
    let calls = 0;
    const fn = () => { calls++; return JSON.stringify({ ok: false, status: 401, body: 'Unauthorized' }); };
    const raw = _withRetry(fn, noop);
    expect(calls).toBe(1);
    expect(JSON.parse(raw).status).toBe(401);
  });

  it('does not retry on 500 server errors', () => {
    let calls = 0;
    const fn = () => { calls++; return JSON.stringify({ ok: false, status: 500, body: 'Internal error' }); };
    _withRetry(fn, noop);
    expect(calls).toBe(1);
  });

  it('detects ECONNREFUSED regardless of surrounding text', () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return calls < 2
        ? JSON.stringify({ ok: false, status: 0, body: 'connect ECONNREFUSED ::1:9999' })
        : success();
    };
    const raw = _withRetry(fn, noop);
    expect(JSON.parse(raw).ok).toBe(true);
    expect(calls).toBe(2);
  });
});
