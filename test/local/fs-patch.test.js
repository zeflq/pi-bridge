import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { patchFs } = require('../../src/local/fs-patch.js');

const TOKEN = 'fs-patch-test-token';
let serverProcess;
let port;
let fakeRoot;
let tmpDir;

// Track calls by having the server write to a shared state file
// Since the server is a separate process, we use a simple IPC via stdout
const SERVER_SCRIPT = (token) => `
const http = require('http');
const TOKEN = ${JSON.stringify(token)};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Log the call to stdout for parent to read (prefixed so it's identifiable)
  process.stdout.write('CALL:' + req.method + ':' + url.pathname + '\\n');

  if (url.pathname === '/list') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(['remote-file.txt']));
    return;
  }
  if (url.pathname === '/read') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('remote content');
    return;
  }
  if (url.pathname === '/exists') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('1');
    return;
  }
  // All POST endpoints
  res.writeHead(200); res.end('ok');
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write('PORT:' + server.address().port + '\\n');
});
`;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bridge-fspatch-'));
  fakeRoot = path.join(tmpDir, 'fake');
  fs.mkdirSync(fakeRoot, { recursive: true });

  // Start the server as a fully independent child process (avoids execFileSync deadlock)
  serverProcess = spawn(process.execPath, ['-e', SERVER_SCRIPT(TOKEN)], {
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
    setTimeout(() => reject(new Error('server did not start')), 5000);
  });

  // Patch fs with our test server
  patchFs(fakeRoot, port, TOKEN);
});

afterAll(() => {
  if (serverProcess && !serverProcess.killed) serverProcess.kill('SIGTERM');
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

const fakePath = () => path.join(fakeRoot, 'sub', 'file.txt');

describe('fs-patch.js', () => {
  describe('fake-root paths → HTTP calls', () => {
    it('readdirSync on fake path returns remote listing', () => {
      const result = fs.readdirSync(fakeRoot);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toContain('remote-file.txt');
    });

    it('readFileSync on fake path returns remote content', () => {
      const result = fs.readFileSync(fakePath(), 'utf8');
      expect(result).toBe('remote content');
    });

    it('existsSync on fake path returns boolean true (server returns 1)', () => {
      const result = fs.existsSync(fakePath());
      expect(result).toBe(true);
    });

    it('writeFileSync on fake path does not throw', () => {
      expect(() => fs.writeFileSync(fakePath(), 'new content', 'utf8')).not.toThrow();
    });

    it('mkdirSync on fake path does not throw', () => {
      expect(() => fs.mkdirSync(path.join(fakeRoot, 'new-dir'), { recursive: true })).not.toThrow();
    });

    it('unlinkSync on fake path does not throw', () => {
      expect(() => fs.unlinkSync(fakePath())).not.toThrow();
    });

    it('renameSync on fake path does not throw', () => {
      const src = path.join(fakeRoot, 'old.txt');
      const dst = path.join(fakeRoot, 'new.txt');
      expect(() => fs.renameSync(src, dst)).not.toThrow();
    });
  });

  describe('non-fake paths → pass through to real fs', () => {
    it('readFileSync on real path reads actual file', () => {
      // Write a file in tmpDir (which is the PARENT of fakeRoot, so outside fakeRoot)
      const realFile = path.join(tmpDir, 'real-check.txt');
      // We need to write it without triggering the patch — use the real path
      // Since tmpDir is outside fakeRoot, writeFileSync should pass through
      fs.writeFileSync(realFile, 'real data', 'utf8');
      const content = fs.readFileSync(realFile, 'utf8');
      expect(content).toBe('real data');
    });

    it('existsSync on real path returns actual result', () => {
      // tmpDir is outside fakeRoot — should return true (it exists)
      expect(fs.existsSync(tmpDir)).toBe(true);
      // A path that definitely doesn't exist
      expect(fs.existsSync(path.join(tmpDir, 'definitely-not-here-xyz.txt'))).toBe(false);
    });
  });
});
