import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { generateToken, createAuthMiddleware } = require('../../src/remote/auth.js');

/**
 * Build a minimal mock req/res/next triple for testing middleware.
 */
function makeMocks(headers = {}) {
  const req = { headers };
  const res = {
    _status: null,
    _body: '',
    writeHead(status) { this._status = status; },
    end(body) { this._body = body || ''; },
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('auth.js', () => {
  describe('generateToken()', () => {
    it('returns a 64-character hex string', () => {
      const token = generateToken();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('generates unique tokens each call', () => {
      const a = generateToken();
      const b = generateToken();
      expect(a).not.toBe(b);
    });
  });

  describe('createAuthMiddleware()', () => {
    const token = 'abc123testtoken';
    const middleware = createAuthMiddleware(token);

    it('calls next() when token matches', () => {
      const { req, res, next } = makeMocks({ 'x-token': token });
      middleware(req, res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res._status).toBeNull();
    });

    it('returns 401 when x-token header is missing', () => {
      const { req, res, next } = makeMocks({});
      middleware(req, res, next);
      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when token is wrong', () => {
      const { req, res, next } = makeMocks({ 'x-token': 'wrongtoken' });
      middleware(req, res, next);
      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when token is empty string', () => {
      const { req, res, next } = makeMocks({ 'x-token': '' });
      middleware(req, res, next);
      expect(res._status).toBe(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('does not call next() when auth fails', () => {
      const { req, res, next } = makeMocks({ 'x-token': 'bad' });
      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
