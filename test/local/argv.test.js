import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// We need a fresh module each time to avoid state pollution from process.argv mutation
// So we reset process.argv before each test and re-require the module.

let originalArgv;

beforeEach(() => {
  originalArgv = [...process.argv];
});

afterEach(() => {
  process.argv.length = 0;
  originalArgv.forEach((a) => process.argv.push(a));
});

function freshParseAndStrip() {
  // Reset module cache and re-require
  delete require.cache[require.resolve('../../src/local/argv.js')];
  const { parseAndStripSshArg } = require('../../src/local/argv.js');
  return parseAndStripSshArg;
}

describe('argv.js', () => {
  it('returns null when --ssh flag is not present', () => {
    process.argv = ['node', 'pi.js', '--some-other-flag'];
    const parseAndStripSshArg = freshParseAndStrip();
    const result = parseAndStripSshArg();
    expect(result).toBeNull();
  });

  it('parses user@host:/path correctly', () => {
    process.argv = ['node', 'pi.js', '--ssh', 'user@host:/root/project'];
    const parseAndStripSshArg = freshParseAndStrip();
    const result = parseAndStripSshArg();
    expect(result).not.toBeNull();
    expect(result.remote).toBe('user@host');
    expect(result.remoteCwd).toBe('/root/project');
  });

  it('parses user@host:~/path correctly (tilde path)', () => {
    process.argv = ['node', 'pi.js', '--ssh', 'ubuntu@10.0.0.1:~/myproject'];
    const parseAndStripSshArg = freshParseAndStrip();
    const result = parseAndStripSshArg();
    expect(result).not.toBeNull();
    expect(result.remote).toBe('ubuntu@10.0.0.1');
    expect(result.remoteCwd).toBe('~/myproject');
  });

  it('strips --ssh and its value from process.argv', () => {
    process.argv = ['node', 'pi.js', '--verbose', '--ssh', 'user@host:/path', '--other'];
    const parseAndStripSshArg = freshParseAndStrip();
    parseAndStripSshArg();
    expect(process.argv).not.toContain('--ssh');
    expect(process.argv).not.toContain('user@host:/path');
    expect(process.argv).toContain('--verbose');
    expect(process.argv).toContain('--other');
  });

  it('throws when --ssh has no value', () => {
    process.argv = ['node', 'pi.js', '--ssh'];
    const parseAndStripSshArg = freshParseAndStrip();
    expect(() => parseAndStripSshArg()).toThrow(/--ssh flag requires a value/);
  });

  it('throws when value has no colon separator', () => {
    process.argv = ['node', 'pi.js', '--ssh', 'user@host'];
    const parseAndStripSshArg = freshParseAndStrip();
    expect(() => parseAndStripSshArg()).toThrow(/format/);
  });

  it('handles nested path with slashes', () => {
    process.argv = ['node', 'pi.js', '--ssh', 'root@192.168.1.1:/root/deep/nested/path'];
    const parseAndStripSshArg = freshParseAndStrip();
    const result = parseAndStripSshArg();
    expect(result.remoteCwd).toBe('/root/deep/nested/path');
  });
});
