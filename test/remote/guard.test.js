import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { createGuard } = require('../../src/remote/guard.js');

const remoteCwd = '/remote/project';

function makeMocks(url) {
  const req = { url, method: 'GET' };
  const res = {
    _status: null,
    _body: '',
    writeHead(status) { this._status = status; },
    end(body) { this._body = body || ''; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('guard.js', () => {
  const guard = createGuard(remoteCwd);

  it('passes through when path is inside remoteCwd', () => {
    const { req, res, next } = makeMocks('/list?path=/remote/project/file.txt');
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res._status).toBeNull();
  });

  it('passes through when path equals remoteCwd exactly', () => {
    const { req, res, next } = makeMocks('/list?path=/remote/project');
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('passes through for nested subdirectory', () => {
    const { req, res, next } = makeMocks('/read?path=/remote/project/sub/dir/file.md');
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when path is outside remoteCwd', () => {
    const { req, res, next } = makeMocks('/list?path=/etc/passwd');
    guard(req, res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 on path traversal with ../', () => {
    const { req, res, next } = makeMocks('/read?path=/remote/project/../../etc/passwd');
    guard(req, res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for sibling directory with same prefix', () => {
    // /remote/project2 must not pass for /remote/project guard
    const { req, res, next } = makeMocks('/list?path=/remote/project2/file.txt');
    guard(req, res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes through when no path param provided (handler deals with it)', () => {
    const { req, res, next } = makeMocks('/list');
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('validates both from and to for rename', () => {
    const { req, res, next } = makeMocks(
      '/rename?from=/remote/project/a.txt&to=/etc/passwd'
    );
    guard(req, res, next);
    expect(res._status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes rename when both from and to are inside remoteCwd', () => {
    const { req, res, next } = makeMocks(
      '/rename?from=/remote/project/a.txt&to=/remote/project/b.txt'
    );
    guard(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
