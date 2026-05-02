'use strict';

const path = require('path');

/**
 * Convert a remote POSIX path to a fake local path under fakeRoot.
 * Handles OS path separators (backslash on Windows, forward slash on Linux/Mac).
 *
 * @param {string} remotePath - Absolute POSIX path on the remote, e.g. '/root/project/file.txt'
 * @param {string} fakeRoot   - Local fake root directory, e.g. '/tmp/pi-bridge'
 * @returns {string}          - Local path, e.g. '/tmp/pi-bridge/root/project/file.txt'
 */
function toFakePath(remotePath, fakeRoot) {
  // Split on '/' and filter empty segments (leading slash produces one)
  const segments = remotePath.split('/').filter(Boolean);
  return path.join(fakeRoot, ...segments);
}

/**
 * Convert a fake local path back to a remote POSIX path.
 * Strips fakeRoot prefix and normalises separators to forward slashes.
 *
 * @param {string} fakePath - Local path, e.g. '/tmp/pi-bridge/root/project/file.txt'
 * @param {string} fakeRoot - Local fake root directory, e.g. '/tmp/pi-bridge'
 * @returns {string}        - Remote POSIX path, e.g. '/root/project/file.txt'
 */
function toRemotePath(fakePath, fakeRoot) {
  // Ensure fakeRoot does not have a trailing separator for consistent slicing
  const root = fakeRoot.endsWith(path.sep)
    ? fakeRoot.slice(0, -1)
    : fakeRoot;

  const relative = fakePath.slice(root.length);
  // On Windows path.sep is '\'; normalise to '/'
  return relative.split(path.sep).join('/');
}

/**
 * Check whether a given path is under the fake root.
 *
 * @param {string} p        - Path to test
 * @param {string} fakeRoot - Local fake root directory
 * @returns {boolean}
 */
function isFakePath(p, fakeRoot) {
  // Normalise fakeRoot to not have trailing separator
  const root = fakeRoot.endsWith(path.sep)
    ? fakeRoot.slice(0, -1)
    : fakeRoot;

  return p === root || p.startsWith(root + path.sep);
}

module.exports = { toFakePath, toRemotePath, isFakePath };
