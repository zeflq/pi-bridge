import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { httpGet, httpPost } = require('../../src/local/http-client.js');

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
