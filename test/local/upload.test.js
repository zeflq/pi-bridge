import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildBundle } = require('../../src/local/upload.js');

describe('upload.js - buildBundle()', () => {
  let bundle;

  // Build once for all tests
  bundle = buildBundle();

  it('returns a non-empty string', () => {
    expect(typeof bundle).toBe('string');
    expect(bundle.length).toBeGreaterThan(100);
  });

  it('contains protocol constants (ENDPOINTS)', () => {
    expect(bundle).toContain('/list');
    expect(bundle).toContain('/read');
    expect(bundle).toContain('/exists');
    expect(bundle).toContain('/write');
    expect(bundle).toContain('/mkdir');
    expect(bundle).toContain('/delete');
    expect(bundle).toContain('/rename');
  });

  it('contains the token header constant', () => {
    expect(bundle).toContain('x-token');
  });

  it('does NOT contain require() calls to shared or remote sub-modules', () => {
    // The bundle is self-contained — no cross-file requires should remain
    expect(bundle).not.toContain("require('./shared/protocol')");
    expect(bundle).not.toContain("require('../shared/protocol')");
    expect(bundle).not.toContain("require('./auth')");
    expect(bundle).not.toContain("require('./guard')");
    expect(bundle).not.toContain("require('./handlers')");
  });

  it('contains generateToken function', () => {
    expect(bundle).toContain('generateToken');
  });

  it('contains createAuthMiddleware function', () => {
    expect(bundle).toContain('createAuthMiddleware');
  });

  it('contains createGuard function', () => {
    expect(bundle).toContain('createGuard');
  });

  it('contains createHandlers function', () => {
    expect(bundle).toContain('createHandlers');
  });

  it('contains startServer function', () => {
    expect(bundle).toContain('startServer');
  });

  it('is valid JavaScript (no syntax errors)', () => {
    // Attempt to parse by creating a new Function wrapper
    expect(() => new Function(bundle)).not.toThrow();
  });
});
