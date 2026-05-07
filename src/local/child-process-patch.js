'use strict';

const cp = require('child_process');
const path = require('path');
const { isFakePath, toRemotePath } = require('./path-mapper');

/**
 * Patch child_process spawn/spawnSync/execSync/execFileSync so that commands
 * whose cwd lands inside fakeRoot are transparently redirected to run on
 * the remote machine via SSH.
 *
 * @param {string} fakeRoot - Local fake root directory (real path, no symlinks)
 * @param {string} remote   - SSH target, e.g. 'user@host'
 */
function patchChildProcess(fakeRoot, remote) {
  const origSpawn       = cp.spawn.bind(cp);
  const origSpawnSync   = cp.spawnSync.bind(cp);
  const origExecSync    = cp.execSync.bind(cp);
  const origExecFileSync = cp.execFileSync.bind(cp);

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
   * Returns true for commands that must always run locally, never over SSH.
   * - node / node.exe: pi's internal tooling (session export, compaction, …)
   *   spawns Node with large payloads as args; redirecting those over SSH would
   *   produce an ENAMETOOLONG error on Windows and is never correct anyway.
   * - pi / pii: need local internet access for the Claude API and auth.
   */
  function isLocalOnly(file) {
    const name = normalizeCmd(file).toLowerCase();
    return name === 'node' || name === 'pi' || name === 'pii';
  }

  /**
   * Build SSH args for a file + args invocation:
   * cd to remote cwd, then run the command with shell-quoted arguments.
   */
  function buildSshArgs(file, args, opts) {
    file = normalizeCmd(file);
    const fakeCwd   = effectiveCwd(opts);
    const remoteCwd = toRemotePath(fakeCwd, fakeRoot);

    const argStr = (args || [])
      .map(function(a) { return "'" + String(a).replace(/'/g, "'\\''") + "'"; })
      .join(' ');
    const remoteCmd = 'cd ' + JSON.stringify(remoteCwd) + ' && ' + file + (argStr ? ' ' + argStr : '');

    return ['-o', 'BatchMode=yes', remote, remoteCmd];
  }

  /**
   * Build SSH args for a raw shell command string (used by execSync).
   */
  function buildSshArgsForShell(command, opts) {
    const fakeCwd   = effectiveCwd(opts);
    const remoteCwd = toRemotePath(fakeCwd, fakeRoot);
    const remoteCmd = 'cd ' + JSON.stringify(remoteCwd) + ' && ' + command;
    return ['-o', 'BatchMode=yes', remote, remoteCmd];
  }

  // ── spawn ────────────────────────────────────────────────────────────────────

  cp.spawn = function patchedSpawn(file, args, opts) {
    if (!Array.isArray(args)) { opts = args; args = []; }
    opts = opts || {};

    const cwd = effectiveCwd(opts);
    if (!isFakePath(cwd, fakeRoot) || isLocalOnly(file)) return origSpawn(file, args, opts);

    return origSpawn('ssh', buildSshArgs(file, args, opts), Object.assign({}, opts, { cwd: undefined }));
  };

  // ── spawnSync ────────────────────────────────────────────────────────────────

  cp.spawnSync = function patchedSpawnSync(file, args, opts) {
    if (!Array.isArray(args)) { opts = args; args = []; }
    opts = opts || {};

    const cwd = effectiveCwd(opts);
    if (!isFakePath(cwd, fakeRoot) || isLocalOnly(file)) return origSpawnSync(file, args, opts);

    return origSpawnSync('ssh', buildSshArgs(file, args, opts), Object.assign({}, opts, { cwd: undefined }));
  };

  // ── execSync ─────────────────────────────────────────────────────────────────

  cp.execSync = function patchedExecSync(command, opts) {
    opts = opts || {};

    const cwd = effectiveCwd(opts);
    if (!isFakePath(cwd, fakeRoot)) return origExecSync(command, opts);

    return origExecFileSync('ssh', buildSshArgsForShell(command, opts), Object.assign({}, opts, { cwd: undefined }));
  };

  // ── execFileSync ─────────────────────────────────────────────────────────────

  cp.execFileSync = function patchedExecFileSync(file, args, opts) {
    if (!Array.isArray(args)) { opts = args; args = []; }
    opts = opts || {};

    const cwd = effectiveCwd(opts);
    if (!isFakePath(cwd, fakeRoot) || isLocalOnly(file)) return origExecFileSync(file, args, opts);

    return origExecFileSync('ssh', buildSshArgs(file, args, opts), Object.assign({}, opts, { cwd: undefined }));
  };
}

module.exports = { patchChildProcess };
