#!/usr/bin/env node
'use strict';

/**
 * pii — pi-bridge entry point installed as a global binary.
 *
 * Locates the `pi` CLI JS file and its bundled Node binary (if any), then
 * respawns with --require preload.js so the bridge is active before pi loads.
 *
 * Resolution strategy (same on all platforms):
 *   1. Get the wrapper script path from the system (which pi / Get-Command pi)
 *   2. Derive basedir from the wrapper path
 *   3. Find the actual CLI JS at basedir/node_modules/@mariozechner/pi-coding-agent/dist/cli.js
 *   4. Use basedir/node.exe if present (pi ships its own Node on some installs),
 *      otherwise fall back to the current Node binary
 */

const { spawnSync, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const preload = path.join(__dirname, '..', 'src', 'local', 'preload.js');

const PI_CLI_REL = path.join('node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js');

function getWrapperPath() {
  if (os.platform() === 'win32') {
    return execFileSync(
      'powershell',
      ['-NoProfile', '-Command', '(Get-Command pi -ErrorAction Stop).Source'],
      { encoding: 'utf8' }
    ).trim();
  }
  return execFileSync('which', ['pi'], { encoding: 'utf8' }).trim();
}

function findPiCli() {
  const wrapper = getWrapperPath();
  const basedir = path.dirname(wrapper);

  const cli = path.join(basedir, PI_CLI_REL);
  if (!fs.existsSync(cli)) {
    throw new Error(
      'Could not find pi CLI at ' + cli + '\n' +
      'Make sure pi is installed: npm install -g @mariozechner/pi-coding-agent'
    );
  }

  // Prefer the Node binary bundled alongside pi (some installs ship node.exe)
  const localNode = path.join(basedir, 'node.exe');
  const nodeExe = fs.existsSync(localNode) ? localNode : process.execPath;

  return { cli, nodeExe };
}

let cli, nodeExe;
try {
  ({ cli, nodeExe } = findPiCli());
} catch (err) {
  process.stderr.write('pii: ' + err.message + '\n');
  process.exit(1);
}

const result = spawnSync(
  nodeExe,
  ['--require', preload, cli, ...process.argv.slice(2)],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
