'use strict';

const { removeFakeDir } = require('./fake-dir');
const { sshExecSync } = require('./ssh');

/**
 * Register a process.on('exit') handler that tears down the bridge session.
 *
 * Cleanup actions (best-effort — errors are suppressed):
 *   1. Remove the fake local directory
 *   2. Kill the SSH tunnel process
 *   3. Delete the remote server script via SSH
 *
 * @param {object} opts
 * @param {string} opts.fakeRoot        - Local fake root path to remove
 * @param {import('child_process').ChildProcess} opts.tunnelProcess - SSH tunnel child process
 * @param {string} opts.remote          - SSH target, e.g. 'user@host'
 * @param {string} [opts.remoteScript]  - Remote script path (default: /tmp/pi-bridge-server.js)
 */
function registerCleanup({ fakeRoot, tunnelProcess, remote, remoteScript }) {
  const scriptPath = remoteScript || '/tmp/pi-bridge-server.js';

  function cleanup() {
    // 1. Remove fake local directory
    if (fakeRoot) {
      removeFakeDir(fakeRoot);
    }

    // 2. Kill tunnel process
    if (tunnelProcess && !tunnelProcess.killed) {
      try {
        tunnelProcess.kill('SIGTERM');
      } catch (_) {
        // Ignore
      }
    }

    // 3. Delete remote server script
    if (remote) {
      try {
        sshExecSync(remote, 'rm -f ' + scriptPath);
      } catch (_) {
        // Ignore — cleanup is best-effort
      }
    }
  }

  process.on('exit', cleanup);
  // Also handle SIGINT / SIGTERM so Ctrl-C triggers cleanup
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
}

module.exports = { registerCleanup };
