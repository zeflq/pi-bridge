import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ENDPOINTS, TOKEN_HEADER, ERRORS } = require('../../src/shared/protocol.js');

describe('protocol.js', () => {
  describe('ENDPOINTS', () => {
    it('defines all required endpoint paths', () => {
      expect(ENDPOINTS.list).toBe('/list');
      expect(ENDPOINTS.read).toBe('/read');
      expect(ENDPOINTS.exists).toBe('/exists');
      expect(ENDPOINTS.write).toBe('/write');
      expect(ENDPOINTS.mkdir).toBe('/mkdir');
      expect(ENDPOINTS.delete).toBe('/delete');
      expect(ENDPOINTS.rename).toBe('/rename');
    });

    it('all endpoint paths start with /', () => {
      for (const [key, val] of Object.entries(ENDPOINTS)) {
        expect(val, `${key} should start with /`).toMatch(/^\//);
      }
    });
  });

  describe('TOKEN_HEADER', () => {
    it('is defined as x-token', () => {
      expect(TOKEN_HEADER).toBe('x-token');
    });

    it('is a non-empty string', () => {
      expect(typeof TOKEN_HEADER).toBe('string');
      expect(TOKEN_HEADER.length).toBeGreaterThan(0);
    });
  });

  describe('ERRORS', () => {
    it('defines unauthorized as 401', () => {
      expect(ERRORS.unauthorized).toBe(401);
    });

    it('defines forbidden as 403', () => {
      expect(ERRORS.forbidden).toBe(403);
    });

    it('defines notFound as 404', () => {
      expect(ERRORS.notFound).toBe(404);
    });

    it('all error codes are HTTP status numbers', () => {
      for (const [key, code] of Object.entries(ERRORS)) {
        expect(typeof code, `${key} should be a number`).toBe('number');
        expect(code).toBeGreaterThanOrEqual(400);
        expect(code).toBeLessThan(600);
      }
    });
  });
});
