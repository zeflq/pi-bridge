'use strict';

// Locates the pi CLI entrypoint (a JS file) and the node binary to run it with.
// Used by bin/pii.js; kept separate so it can be unit-tested.

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Prefer the current @earendil-works scope; keep @mariozechner as a legacy
// fallback for machines that installed pi before it moved off that scope.
const PI_PACKAGES = [
  path.join('@earendil-works', 'pi-coding-agent'),
  path.join('@mariozechner', 'pi-coding-agent'),
];

// List every `pi` on the PATH that pii inherited from its launching shell.
// We resolve against that PATH (not a fresh `-NoProfile` shell) so that bundled
// installs added to PATH via the user's profile are actually visible.
function locateOnPath(cmd, platform = process.platform) {
  const finder = platform === 'win32' ? 'where.exe' : 'which';
  try {
    const out = execFileSync(finder, [cmd], { encoding: 'utf8' });
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

// Resolve a pi package's CLI from its package.json `bin` field, so we follow
// whatever entrypoint the installed version declares (dist/cli.js in older
// releases, dist/bundle/cli.js since 1.5).
function cliFromPackage(pkgDir) {
  let rel = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.pi;
  } catch (_) {
    return null;
  }
  const candidates = [rel, 'dist/bundle/cli.js', 'dist/cli.js'].filter(Boolean);
  for (const c of candidates) {
    const cli = path.resolve(pkgDir, c);
    if (fs.existsSync(cli)) return cli;
  }
  return null;
}

function cliFromNodeModules(nodeModulesDir) {
  for (const name of PI_PACKAGES) {
    const cli = cliFromPackage(path.join(nodeModulesDir, name));
    if (cli) return cli;
  }
  return null;
}

// True if the file is something node can execute: either it has a node
// shebang or no shebang at all. Rejects npm's extensionless `sh` shims
// (`#!/bin/sh` + `basedir=$(dirname ...)`), which node would choke on.
function looksLikeNodeScript(file) {
  let head;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(256);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      head = buf.toString('utf8', 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return false;
  }
  if (!head.startsWith('#!')) return true;
  return /\bnode\b/.test(head.split(/\r?\n/, 1)[0]);
}

function findPi({
  bridgeBinDir,
  locate = locateOnPath,
  platform = process.platform,
  execPath = process.execPath,
} = {}) {
  // 1. Standard npm global: pii and pi share the same node_modules dir
  //    (<node_modules>/pi-bridge/bin -> <node_modules>).
  if (bridgeBinDir) {
    const cli = cliFromNodeModules(path.resolve(bridgeBinDir, '..', '..'));
    if (cli) return { cli, nodeExe: execPath };
  }

  // 2. Resolve `pi` from PATH. Covers npm globals when pi-bridge itself is
  //    linked from a local checkout, the pi.dev installer (bundled Node plus a
  //    bare `bin/pi` symlink straight to cli.js, often outside any npm prefix)
  //    and dev clones.
  const exe = platform === 'win32' ? '.exe' : '';
  for (const cmd of locate('pi', platform)) {
    const dir = path.dirname(cmd);
    const localNode = path.join(dir, 'node' + exe);
    const nodeExe = fs.existsSync(localNode) ? localNode : execPath;

    // 2a. npm prefix layouts next to the launcher:
    //     Windows: <prefix>/pi(.cmd) + <prefix>/node_modules/...
    //     POSIX:   <prefix>/bin/pi   + <prefix>/lib/node_modules/...
    const npmCli =
      cliFromNodeModules(path.join(dir, 'node_modules')) ||
      cliFromNodeModules(path.join(dir, '..', 'lib', 'node_modules'));
    if (npmCli) return { cli: npmCli, nodeExe };

    // 2b. Follow the launcher to its real JS entrypoint.
    let real;
    try { real = fs.realpathSync(cmd); } catch (_) { real = cmd; }

    let cli = null;
    if (/\.[cm]?js$/i.test(real) && fs.existsSync(real)) {
      cli = real;                                   // symlink/shim -> cli.js
    } else if (fs.existsSync(path.join(dir, 'pi.js'))) {
      cli = path.join(dir, 'pi.js');                // bundled wrapper + sibling
    } else if (!/\.(cmd|ps1|bat|exe)$/i.test(real) && looksLikeNodeScript(real)) {
      cli = real;                                   // shebang JS with no extension
    }
    if (cli) return { cli, nodeExe };
  }

  return null;
}

module.exports = { findPi, cliFromPackage, looksLikeNodeScript, locateOnPath };
