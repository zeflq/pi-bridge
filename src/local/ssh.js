'use strict';

const { execFileSync } = require('child_process');

/**
 * Execute a shell command on a remote machine over SSH synchronously.
 * Uses BatchMode=yes to prevent interactive prompts (fail fast if no key auth).
 *
 * @param {string} remote - SSH target, e.g. 'user@host'
 * @param {string} cmd    - Shell command to run on remote
 * @returns {string}      - stdout as a trimmed string
 * @throws                - On non-zero exit or SSH error
 */
function sshExecSync(remote, cmd) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', remote, cmd], {
    encoding: 'utf8',
  });
}

module.exports = { sshExecSync };
