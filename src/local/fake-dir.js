'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Capture rmSync before any monkey-patching so cleanup always hits the local
// filesystem rather than being redirected through the SSH bridge.
const origRmSync = fs.rmSync.bind(fs);

/**
 * Sanitise an SSH target string (user@host or alias) into a safe dir name.
 */
function sanitizeRemote(remote) {
  return remote.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Create the fake local directory skeleton for the given remote path.
 *
 * The directory lives under ~/.pi-bridge/<remote>/ rather than the OS temp
 * directory so it survives reboots — this prevents pi's session-cwd check
 * from failing when it tries to resume a previous session whose cwd points
 * at a directory that was cleaned up between runs.
 *
 * Example:
 *   remote    = 'myserver'
 *   remoteCwd = '/root/project-x'
 *   fakeRoot  = '~/.pi-bridge/myserver'
 *   fakeLocalCwd = '~/.pi-bridge/myserver/root/project-x'
 *
 * @param {string} remote    - SSH target, e.g. 'user@host' or alias
 * @param {string} remoteCwd - Absolute remote path, e.g. '/root/project-x'
 * @returns {{ fakeRoot: string, fakeLocalCwd: string }}
 */
function createFakeDir(remote, remoteCwd) {
  const fakeRootRaw = path.join(os.homedir(), '.pi-bridge', sanitizeRemote(remote));

  // Build the local mirror path from the remote path segments
  const segments = remoteCwd.split('/').filter(Boolean);
  const fakeLocalCwdRaw = path.join(fakeRootRaw, ...segments);

  fs.mkdirSync(fakeLocalCwdRaw, { recursive: true });

  // Resolve symlinks so the prefix matches what process.cwd() returns after
  // chdir — on macOS /var/folders/… is a symlink to /private/var/folders/…
  const fakeRoot = fs.realpathSync(fakeRootRaw);
  const fakeLocalCwd = fs.realpathSync(fakeLocalCwdRaw);

  return { fakeRoot, fakeLocalCwd };
}

/**
 * Remove the fake root directory and all its contents.
 * Uses the captured original rmSync to ensure the local directory is removed
 * even when this is called after fs has been monkey-patched by the bridge.
 *
 * @param {string} fakeRoot - Path returned by createFakeDir
 */
function removeFakeDir(fakeRoot) {
  try {
    origRmSync(fakeRoot, { recursive: true, force: true });
  } catch (_) {
    // Best-effort removal — do not throw during cleanup
  }
}

module.exports = { createFakeDir, removeFakeDir };
