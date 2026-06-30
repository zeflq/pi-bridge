#!/usr/bin/env node
'use strict';

const { spawnSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const pkg = require('../package.json');
const preload = path.join(__dirname, '..', 'src', 'local', 'preload.js');

if (process.argv.includes('--version') || process.argv.includes('-v') || process.argv.includes('--v')) {
  process.stdout.write('pi-bridge/' + pkg.version + '\n');
  process.exit(0);
}

// List every `pi` on the PATH that pii inherited from its launching shell.
// We resolve against that PATH (not a fresh `-NoProfile` shell) so that bundled
// installs added to PATH via the user's profile are actually visible.
function locateOnPath(cmd) {
  const finder = os.platform() === 'win32' ? 'where.exe' : 'which';
  try {
    const out = execFileSync(finder, [cmd], { encoding: 'utf8' });
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function findPi() {
  // 1. Standard npm global: pii and pi share the same node_modules prefix.
  //    Prefer the current @earendil-works scope; keep @mariozechner as a legacy
  //    fallback for machines that installed pi before it moved off that scope.
  const sharedCandidates = [
    path.resolve(__dirname, '..', '..', '@earendil-works', 'pi-coding-agent', 'dist', 'cli.js'),
    path.resolve(__dirname, '..', '..', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js'),
  ];
  for (const cli of sharedCandidates) {
    if (fs.existsSync(cli)) return { cli, nodeExe: process.execPath };
  }

  // 2. Resolve `pi` from PATH and follow it to its real JS entrypoint. The
  //    pi.dev installer (curl https://pi.dev/install.sh | sh) drops a bundled
  //    Node plus a bare `bin/pi` symlink that points straight at the package's
  //    cli.js — often outside any npm prefix — so we realpath the symlink rather
  //    than guessing filenames. Also covers npm shims and dev clones (which
  //    expose pi as a symlink to cli.js too), and a bundled node next to pi is
  //    preferred for version-matched execution.
  const exe = os.platform() === 'win32' ? '.exe' : '';
  for (const cmd of locateOnPath('pi')) {
    let real;
    try { real = fs.realpathSync(cmd); } catch (_) { real = cmd; }

    let cli = null;
    if (/\.[cm]?js$/i.test(real) && fs.existsSync(real)) {
      cli = real;                                   // symlink/shim -> cli.js
    } else if (fs.existsSync(path.join(path.dirname(cmd), 'pi.js'))) {
      cli = path.join(path.dirname(cmd), 'pi.js');  // bundled wrapper + sibling
    } else if (!/\.(cmd|ps1|bat|exe)$/i.test(real)) {
      cli = real;                                   // shebang JS with no extension
    }
    if (!cli) continue;

    const localNode = path.join(path.dirname(cmd), 'node' + exe);
    const nodeExe = fs.existsSync(localNode) ? localNode : process.execPath;
    return { cli, nodeExe };
  }

  return null;
}

let pi;
try {
  pi = findPi();
} catch (_) {}

if (!pi) {
  process.stderr.write(
    'pii: Could not find pi on your PATH.\n' +
    'If pi is already installed, re-open your shell so the install is on PATH, then retry.\n' +
    'Otherwise install pi: curl -fsSL https://pi.dev/install.sh | sh\n'
  );
  process.exit(1);
}

// Expose resolved pi paths so child-process-patch can re-spawn pi correctly
// when the review skill (or any internal tool) calls `pi` as a subprocess.
process.env.PI_BRIDGE_CLI  = pi.cli;
process.env.PI_BRIDGE_NODE = pi.nodeExe;

const result = spawnSync(
  pi.nodeExe,
  ['--require', preload, pi.cli, ...process.argv.slice(2)],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
