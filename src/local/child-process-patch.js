'use strict';

const cp = require('child_process');
const path = require('path');
const { isFakePath, toRemotePath } = require('./path-mapper');

/**
 * Patch child_process.spawn and child_process.spawnSync so that commands
 * whose cwd lands inside fakeRoot are transparently redirected to run on
 * the remote machine via SSH.
 *
 * Pi's bash tool uses spawn/spawnSync exclusively, so this covers all shell
 * command execution (ls, cat, grep, npm run, etc.).
 *
 * @param {string} fakeRoot - Local fake root directory (real path, no symlinks)
 * @param {string} remote   - SSH target, e.g. 'user@host'
 */
function patchChildProcess(fakeRoot, remote) {
  const origSpawn     = cp.spawn.bind(cp);
  const origSpawnSync = cp.spawnSync.bind(cp);

  /**
   * Resolve the effective cwd from spawn options.
   * Falls back to process.cwd() when opts.cwd is not set.
   */
  function effectiveCwd(opts) {
    const c = opts && opts.cwd;
    if (!c) return process.cwd();
    return typeof c === 'string' ? path.resolve(c) : c.toString();
  }

  /**
   * On Windows, pi may call spawn with a full exe path like
   * C:\Program Files\Git\bin\bash.exe. Strip it to the bare command name
   * ('bash') so the remote Linux shell can find it.
   */
  function normalizeCmd(file) {
    if (process.platform !== 'win32') return file;
    return path.basename(String(file)).replace(/\.exe$/i, '');
  }

  /**
   * Build the SSH-redirected command: cd to remote cwd, then run the
   * original command with its arguments, all shell-quoted.
   */
  function buildSshArgs(file, args, opts) {
    file = normalizeCmd(file);
    const fakeCwd    = effectiveCwd(opts);
    const remoteCwd  = toRemotePath(fakeCwd, fakeRoot);

    // Reconstruct the command string with shell-safe quoting
    const argStr = (args || [])
      .map(function(a) { return "'" + String(a).replace(/'/g, "'\\''") + "'"; })
      .join(' ');
    const remoteCmd = 'cd ' + JSON.stringify(remoteCwd) + ' && ' + file + (argStr ? ' ' + argStr : '');

    return ['-o', 'BatchMode=yes', remote, remoteCmd];
  }

  // ── spawn ────────────────────────────────────────────────────────────────────

  cp.spawn = function patchedSpawn(file, args, opts) {
    // Normalise overloaded signature: spawn(file) / spawn(file, opts) / spawn(file, args, opts)
    if (!Array.isArray(args)) { opts = args; args = []; }
    opts = opts || {};

    const cwd = effectiveCwd(opts);
    if (!isFakePath(cwd, fakeRoot)) return origSpawn(file, args, opts);

    return origSpawn('ssh', buildSshArgs(file, args, opts), Object.assign({}, opts, { cwd: undefined }));
  };

  // ── spawnSync ────────────────────────────────────────────────────────────────

  cp.spawnSync = function patchedSpawnSync(file, args, opts) {
    if (!Array.isArray(args)) { opts = args; args = []; }
    opts = opts || {};

    const cwd = effectiveCwd(opts);
    if (!isFakePath(cwd, fakeRoot)) return origSpawnSync(file, args, opts);

    return origSpawnSync('ssh', buildSshArgs(file, args, opts), Object.assign({}, opts, { cwd: undefined }));
  };
}

module.exports = { patchChildProcess };
