import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createHandlers } = require('../../src/remote/handlers.js');

// Create a temp dir for handler tests
let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bridge-handlers-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/**
 * Build a minimal mock req/res that simulates Node http.IncomingMessage/ServerResponse.
 */
function makeReq(method, url, body = '') {
  const chunks = body ? [Buffer.from(body, 'utf8')] : [];
  const req = {
    method,
    url,
    headers: {},
    _chunks: chunks,
    on(event, cb) {
      if (event === 'data') {
        for (const chunk of this._chunks) cb(chunk);
      }
      if (event === 'end') {
        // call on next tick via Promise trick — but we need sync in tests
        // Use setImmediate to let the event loop process
        setImmediate(cb);
      }
      if (event === 'error') {
        // noop
      }
      return this;
    },
  };
  return req;
}

function makeRes() {
  const res = {
    _status: null,
    _headers: {},
    _body: '',
    writeHead(status, headers) {
      this._status = status;
      if (headers) Object.assign(this._headers, headers);
    },
    end(body) {
      this._body = (body || '').toString();
    },
  };
  return res;
}

async function callHandler(method, url, body = '') {
  const handle = createHandlers();
  const req = makeReq(method, url, body);
  const res = makeRes();
  await handle(req, res);
  return res;
}

describe('handlers.js', () => {
  describe('GET /list', () => {
    it('lists directory contents', async () => {
      fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'hello');
      fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'world');
      const res = await callHandler('GET', '/list?path=' + encodeURIComponent(tmpDir));
      expect(res._status).toBe(200);
      const entries = JSON.parse(res._body);
      expect(entries).toContain('a.txt');
      expect(entries).toContain('b.txt');
    });

    it('returns 400 when path is missing', async () => {
      const res = await callHandler('GET', '/list');
      expect(res._status).toBe(400);
    });

    it('returns 404 for non-existent directory', async () => {
      const res = await callHandler('GET', '/list?path=' + encodeURIComponent('/nonexistent-dir-12345'));
      expect(res._status).toBe(404);
    });
  });

  describe('GET /read', () => {
    it('reads file content', async () => {
      const filePath = path.join(tmpDir, 'read-test.txt');
      fs.writeFileSync(filePath, 'file content here', 'utf8');
      const res = await callHandler('GET', '/read?path=' + encodeURIComponent(filePath));
      expect(res._status).toBe(200);
      expect(res._body).toBe('file content here');
    });

    it('returns 400 when path is missing', async () => {
      const res = await callHandler('GET', '/read');
      expect(res._status).toBe(400);
    });

    it('returns 404 for non-existent file', async () => {
      const res = await callHandler('GET', '/read?path=' + encodeURIComponent(path.join(tmpDir, 'no-such-file.txt')));
      expect(res._status).toBe(404);
    });
  });

  describe('GET /exists', () => {
    it('returns 1 for existing file', async () => {
      const filePath = path.join(tmpDir, 'exists-test.txt');
      fs.writeFileSync(filePath, 'x');
      const res = await callHandler('GET', '/exists?path=' + encodeURIComponent(filePath));
      expect(res._status).toBe(200);
      expect(res._body).toBe('1');
    });

    it('returns 0 for non-existent file', async () => {
      const res = await callHandler('GET', '/exists?path=' + encodeURIComponent(path.join(tmpDir, 'ghost.txt')));
      expect(res._status).toBe(200);
      expect(res._body).toBe('0');
    });

    it('returns 400 when path is missing', async () => {
      const res = await callHandler('GET', '/exists');
      expect(res._status).toBe(400);
    });
  });

  describe('POST /write', () => {
    it('writes content to a file', async () => {
      const filePath = path.join(tmpDir, 'write-test.txt');
      const res = await callHandler('POST', '/write?path=' + encodeURIComponent(filePath), 'written content');
      expect(res._status).toBe(200);
      expect(fs.readFileSync(filePath, 'utf8')).toBe('written content');
    });

    it('returns 400 when path is missing', async () => {
      const res = await callHandler('POST', '/write', 'data');
      expect(res._status).toBe(400);
    });
  });

  describe('POST /mkdir', () => {
    it('creates a directory recursively', async () => {
      const dirPath = path.join(tmpDir, 'new', 'nested', 'dir');
      const res = await callHandler('POST', '/mkdir?path=' + encodeURIComponent(dirPath));
      expect(res._status).toBe(200);
      expect(fs.existsSync(dirPath)).toBe(true);
    });

    it('returns 400 when path is missing', async () => {
      const res = await callHandler('POST', '/mkdir');
      expect(res._status).toBe(400);
    });
  });

  describe('POST /delete', () => {
    it('deletes a file', async () => {
      const filePath = path.join(tmpDir, 'delete-me.txt');
      fs.writeFileSync(filePath, 'bye');
      const res = await callHandler('POST', '/delete?path=' + encodeURIComponent(filePath));
      expect(res._status).toBe(200);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('returns 404 for non-existent file', async () => {
      const res = await callHandler('POST', '/delete?path=' + encodeURIComponent(path.join(tmpDir, 'no-such.txt')));
      expect(res._status).toBe(404);
    });

    it('returns 400 when path is missing', async () => {
      const res = await callHandler('POST', '/delete');
      expect(res._status).toBe(400);
    });
  });

  describe('POST /rename', () => {
    it('renames a file', async () => {
      const src = path.join(tmpDir, 'rename-src.txt');
      const dst = path.join(tmpDir, 'rename-dst.txt');
      fs.writeFileSync(src, 'data');
      const res = await callHandler(
        'POST',
        '/rename?from=' + encodeURIComponent(src) + '&to=' + encodeURIComponent(dst)
      );
      expect(res._status).toBe(200);
      expect(fs.existsSync(src)).toBe(false);
      expect(fs.existsSync(dst)).toBe(true);
    });

    it('returns 400 when from is missing', async () => {
      const res = await callHandler('POST', '/rename?to=' + encodeURIComponent(path.join(tmpDir, 'x.txt')));
      expect(res._status).toBe(400);
    });

    it('returns 400 when to is missing', async () => {
      const res = await callHandler('POST', '/rename?from=' + encodeURIComponent(path.join(tmpDir, 'x.txt')));
      expect(res._status).toBe(400);
    });
  });

  describe('Unknown endpoints', () => {
    it('returns 404 for unknown path', async () => {
      const res = await callHandler('GET', '/unknown');
      expect(res._status).toBe(404);
    });
  });
});
