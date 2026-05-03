'use strict';

const { spawn, execFileSync } = require('child_process');

const SSH_ARGS = (remote, port) => [
  '-o', 'BatchMode=yes',
  '-o', 'ExitOnForwardFailure=yes',
  '-N',
  '-L', `${port}:127.0.0.1:${port}`,
  remote,
];

/**
 * Start an SSH port-forward tunnel with auto-reconnect.
 *
 * If the tunnel process exits (sleep/wake, network drop, etc.) it is
 * automatically restarted after a short back-off delay.  The returned
 * handle exposes a `kill()` method used by cleanup.js to stop reconnecting
 * and tear down the current process.
 *
 * @param {string} remote          - SSH target, e.g. 'user@host'
 * @param {number} port            - Port number to forward (same port both sides)
 * @param {object} [opts]
 * @param {Function} [opts._spawn] - Override spawn (for testing)
 * @returns {{ kill: () => void }}
 */
function startTunnel(remote, port, { _spawn = spawn } = {}) {
  let child = null;
  let stopped = false;
  let backoff = 1000; // ms — resets to 1s on each successful reconnect

  function spawn_() {
    child = _spawn('ssh', SSH_ARGS(remote, port), {
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: false,
    });

    child.on('exit', (code) => {
      if (stopped) return;
      // Back off up to 10s, then retry indefinitely
      setTimeout(() => {
        if (stopped) return;
        backoff = Math.min(backoff * 2, 10000);
        spawn_();
      }, backoff);
    });

    // Reset backoff once the tunnel has been alive for a while
    setTimeout(() => { backoff = 1000; }, 5000);
  }

  spawn_();

  // Brief sync sleep so the tunnel is ready before the first HTTP call.
  try {
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},500)'], {
      encoding: 'utf8',
    });
  } catch (_) {}

  return {
    kill() {
      stopped = true;
      if (child) child.kill();
    },
  };
}

module.exports = { startTunnel };
