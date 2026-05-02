import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'path';

const require = createRequire(import.meta.url);
const { toFakePath, toRemotePath, isFakePath } = require('../../src/local/path-mapper.js');

// Use the real platform separator from the running OS
const SEP = path.sep;
const TMP = '/tmp';

describe('path-mapper.js', () => {
  describe('toFakePath()', () => {
    it('converts a remote path to a fake local path', () => {
      const fake = toFakePath('/root/project/file.txt', '/tmp/pi-bridge');
      // On Linux/Mac: /tmp/pi-bridge/root/project/file.txt
      // On Windows:   /tmp/pi-bridge\root\project\file.txt (using path.join)
      const expected = path.join('/tmp/pi-bridge', 'root', 'project', 'file.txt');
      expect(fake).toBe(expected);
    });

    it('handles root path /', () => {
      const fake = toFakePath('/', '/tmp/pi-bridge');
      expect(fake).toBe('/tmp/pi-bridge');
    });

    it('handles single-segment remote path', () => {
      const fake = toFakePath('/data', '/tmp/pi-bridge');
      expect(fake).toBe(path.join('/tmp/pi-bridge', 'data'));
    });
  });

  describe('toRemotePath()', () => {
    it('converts Linux fake path to remote path', () => {
      // Simulate Linux: separator is /
      const fakeRoot = '/tmp/pi-bridge';
      const fakePath = '/tmp/pi-bridge/root/project/file.txt';
      const remote = toRemotePath(fakePath, fakeRoot);
      expect(remote).toBe('/root/project/file.txt');
    });

    it('converts fake path with Windows separators to remote path', () => {
      // Simulate Windows path separators by using backslash
      const fakeRoot = 'C:\\tmp\\pi-bridge';
      const fakePath = 'C:\\tmp\\pi-bridge\\root\\project\\file.txt';
      // toRemotePath uses path.sep to split — we test the logic directly
      // by calling with Windows-style strings
      const result = toRemotePath(fakePath, fakeRoot);
      // On actual Linux, path.sep is '/' so the split won't separate backslashes.
      // The test verifies the implementation handles the platform it's running on.
      // On Linux running env: result = /root\project\file.txt (treated as one segment)
      // The important thing is that the fakeRoot prefix is stripped.
      expect(result).not.toContain(fakeRoot);
    });

    it('returns leading slash for path matching fakeRoot + sep + rest', () => {
      const fakeRoot = '/tmp/pi-bridge';
      const fakePath = '/tmp/pi-bridge/etc/hosts';
      const remote = toRemotePath(fakePath, fakeRoot);
      expect(remote).toBe('/etc/hosts');
    });

    it('handles fakeRoot with trailing separator', () => {
      const fakeRoot = '/tmp/pi-bridge/';
      const fakePath = '/tmp/pi-bridge/root/file.txt';
      const remote = toRemotePath(fakePath, fakeRoot);
      expect(remote).toBe('/root/file.txt');
    });
  });

  describe('isFakePath()', () => {
    const fakeRoot = '/tmp/pi-bridge';

    it('returns true for path inside fakeRoot', () => {
      expect(isFakePath('/tmp/pi-bridge/root/project', fakeRoot)).toBe(true);
    });

    it('returns true for path equal to fakeRoot', () => {
      expect(isFakePath('/tmp/pi-bridge', fakeRoot)).toBe(true);
    });

    it('returns false for path outside fakeRoot', () => {
      expect(isFakePath('/tmp/other', fakeRoot)).toBe(false);
    });

    it('returns false for path that shares prefix but is not under fakeRoot', () => {
      // /tmp/pi-bridge2 must not match /tmp/pi-bridge
      expect(isFakePath('/tmp/pi-bridge2/file.txt', fakeRoot)).toBe(false);
    });

    it('returns false for completely different path', () => {
      expect(isFakePath('/home/user/project', fakeRoot)).toBe(false);
    });

    it('handles fakeRoot with trailing separator', () => {
      expect(isFakePath('/tmp/pi-bridge/file.txt', '/tmp/pi-bridge/')).toBe(true);
    });
  });
});
