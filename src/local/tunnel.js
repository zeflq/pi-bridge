'use strict';

const { spawn, execFileSync } = require('child_process');

/**
 * Start an SSH port-forward tunnel: local:port → remote:port.
 * The tunnel process runs in the background for the lifetime of the session.
 *
 * @param {string} remote - SSH target, e.g. 'user@host'
 * @param {number} port   - Port number to forward (same port both sides)
 * @returns {import('child_process').ChildProcess} The tunnel child process
 */
function startTunnel(remote, port) {
  const child = spawn(
    'ssh',
    [
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-N',
      '-L', `${port}:127.0.0.1:${port}`,
      remote,
    ],
    {
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: false,
    }
  );

  // Brief sync sleep to give the tunnel time to establish before first HTTP call.
  // 300ms is usually enough for local-network SSH connections.
  try {
    execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},300)'], {
      encoding: 'utf8',
    });
  } catch (_) {
    // Ignore — sleep is best-effort
  }

  return child;
}

module.exports = { startTunnel };
