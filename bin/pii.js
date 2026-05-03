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

function findPi() {
  // 1. Standard npm global: both packages share the same node_modules prefix
  const shared = path.resolve(__dirname, '..', '..', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js');
  if (fs.existsSync(shared)) {
    return { cli: shared, nodeExe: process.execPath };
  }

  // 2. Unix GitHub clone: which pi returns the JS file directly
  if (os.platform() !== 'win32') {
    try {
      const wrapper = execFileSync('which', ['pi'], { encoding: 'utf8' }).trim();
      if (fs.existsSync(wrapper)) return { cli: wrapper, nodeExe: process.execPath };
    } catch (_) {}
  }

  // 3. Fallback: PowerShell Get-Command — handles custom/bundled Windows installs
  //    where pi lives outside the standard npm prefix. Also picks up the bundled
  //    node.exe that shipped alongside pi (required for version-matched execution).
  if (os.platform() === 'win32') {
    try {
      const wrapper = execFileSync(
        'powershell',
        ['-NoProfile', '-Command', '(Get-Command pi -ErrorAction Stop).Source'],
        { encoding: 'utf8' }
      ).trim();
      const basedir = path.dirname(wrapper);
      const cli = wrapper.replace(/\.(ps1|cmd)$/i, '.js');
      const localNode = path.join(basedir, 'node.exe');
      const nodeExe = fs.existsSync(localNode) ? localNode : process.execPath;
      if (fs.existsSync(cli)) return { cli, nodeExe };
    } catch (_) {}
  }

  return null;
}

let pi;
try {
  pi = findPi();
} catch (_) {}

if (!pi) {
  process.stderr.write(
    'pii: Could not find pi.\n' +
    'Install it with: npm install -g @mariozechner/pi-coding-agent\n'
  );
  process.exit(1);
}

const result = spawnSync(
  pi.nodeExe,
  ['--require', preload, pi.cli, ...process.argv.slice(2)],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
