'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Capture rmSync before any monkey-patching so cleanup always hits the local
// filesystem rather than being redirected through the SSH bridge.
const origRmSync = fs.rmSync.bind(fs);

/**
 * Create the fake local directory skeleton for the given remote path.
 * The structure mirrors the remote path so that path-mapper can convert
 * between fake local paths and remote paths deterministically.
 *
 * Example:
 *   remoteCwd = '/root/project-x'
 *   fakeRoot  = '/tmp/pi-bridge'
 *   fakeLocalCwd = '/tmp/pi-bridge/root/project-x'
 *
 * @param {string} remoteCwd - Absolute remote path, e.g. '/root/project-x'
 * @returns {{ fakeRoot: string, fakeLocalCwd: string }}
 */
function createFakeDir(remoteCwd) {
  const fakeRootRaw = path.join(os.tmpdir(), 'pi-bridge');

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
