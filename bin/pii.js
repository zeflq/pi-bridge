#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const pkg = require('../package.json');
const preload = path.join(__dirname, '..', 'src', 'local', 'preload.js');
const { findPi } = require('../src/local/find-pi.js');

if (process.argv.includes('--version') || process.argv.includes('-v') || process.argv.includes('--v')) {
  process.stdout.write('pi-bridge/' + pkg.version + '\n');
  process.exit(0);
}

let pi;
try {
  pi = findPi({ bridgeBinDir: __dirname });
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
