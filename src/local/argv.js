'use strict';

/**
 * Parse and strip --ssh user@host:/path from process.argv.
 *
 * Mutates process.argv in place, removing both '--ssh' and its value.
 *
 * @returns {{ remote: string, remoteCwd: string } | null}
 *   remote    = 'user@host'
 *   remoteCwd = '/path' (or '~/path' — remote shell will expand it)
 *   Returns null if --ssh flag is not present.
 */
function parseAndStripSshArg() {
  const argv = process.argv;
  const idx = argv.indexOf('--ssh');
  if (idx === -1) return null;

  const value = argv[idx + 1];
  if (!value) {
    throw new Error('--ssh flag requires a value: user@host:/path');
  }

  // value format: user@host:/path  or  user@host:~/path
  const colonIdx = value.indexOf(':');
  if (colonIdx === -1) {
    throw new Error('--ssh value must be in format user@host:/path, got: ' + value);
  }

  const remote = value.slice(0, colonIdx);
  const remoteCwd = value.slice(colonIdx + 1);

  if (!remote) {
    throw new Error('--ssh value missing host portion: ' + value);
  }
  if (!remoteCwd) {
    throw new Error('--ssh value missing path portion: ' + value);
  }

  // Strip both '--ssh' and its value from argv
  argv.splice(idx, 2);

  return { remote, remoteCwd };
}

module.exports = { parseAndStripSshArg };
