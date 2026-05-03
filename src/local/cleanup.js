'use strict';

const { removeFakeDir } = require('./fake-dir');
const { sshExecSync } = require('./ssh');

/**
 * Register a process.on('exit') handler that tears down the bridge session.
 *
 * Cleanup actions (best-effort — errors are suppressed):
 *   1. Remove the fake local directory
 *   2. Kill the SSH tunnel process
 *   3. Kill the remote server process (by PID) and remove its log file
 *
 * Each session has a unique sessionId so its log file does not clash with
 * other sessions targeting the same remote working directory.
 *
 * @param {object} opts
 * @param {string}   opts.fakeRoot      - Local fake root path to remove
 * @param {object}   opts.tunnelProcess - SSH tunnel watchdog handle ({ kill() })
 * @param {string}   opts.remote        - SSH target, e.g. 'user@host'
 * @param {string}   opts.sessionId     - Random 8-char hex ID for this session
 * @param {number}   opts.remotePid     - PID of the remote server process
 */
function registerCleanup({ fakeRoot, tunnelProcess, remote, sessionId, remotePid }) {
  const remoteLog = sessionId ? '/tmp/pi-bridge-out-' + sessionId + '.txt' : null;

  function cleanup() {
    // 1. Remove fake local directory
    if (fakeRoot) {
      removeFakeDir(fakeRoot);
    }

    // 2. Kill tunnel watchdog
    if (tunnelProcess) {
      try {
        if (typeof tunnelProcess.kill === 'function') tunnelProcess.kill();
      } catch (_) {}
    }

    // 3. Kill the specific remote server process and clean up its log file
    if (remote) {
      try {
        let cmd = '';
        if (remotePid) cmd += 'kill ' + remotePid + ' 2>/dev/null; ';
        if (remoteLog) cmd += 'rm -f ' + remoteLog;
        if (cmd) sshExecSync(remote, cmd);
      } catch (_) {}
    }
  }

  process.on('exit', cleanup);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
}

module.exports = { registerCleanup };
