'use strict';

/**
 * setup.js — Orchestrator called via spawnSync from preload.js
 *
 * Usage: node setup.js <remote> <remoteCwd>
 *
 * Steps:
 *   1. Upload the bundled remote server script via SSH
 *   2. Start the server on the remote (background process + poll for output)
 *   3. Parse PORT:TOKEN from remote stdout
 *   4. Print { port, token, remoteCwd } as JSON to stdout
 *
 * The tunnel is NOT started here — preload.js spawns it separately so it can
 * hold the child process reference for cleanup.
 */

const { execFileSync } = require('child_process');
const { uploadBundle } = require('./upload');

const remote = process.argv[2];
const remoteCwd = process.argv[3];

if (!remote || !remoteCwd) {
  process.stderr.write('Usage: node setup.js <remote> <remoteCwd>\n');
  process.exit(1);
}

const REMOTE_SCRIPT = '/tmp/pi-bridge-server.js';
const REMOTE_LOG = '/tmp/pi-bridge-out.txt';

try {
  // Step 1: Upload the bundled server script
  uploadBundle(remote, REMOTE_SCRIPT);

  // Step 2: Start server in background on remote, wait briefly, then read output.
  // The server prints "PORT:TOKEN\n" on startup then stays alive serving requests.
  // We start it detached and poll /tmp/pi-bridge-out.txt for the first line.
  const startCmd =
    'rm -f ' + REMOTE_LOG + '; ' +
    'node ' + REMOTE_SCRIPT + ' ' + remoteCwd + ' >' + REMOTE_LOG + ' 2>&1 & ' +
    'disown; ' +
    'for i in $(seq 1 30); do ' +
    '  line=$(head -1 ' + REMOTE_LOG + ' 2>/dev/null); ' +
    '  if [ -n "$line" ]; then echo "$line"; break; fi; ' +
    '  sleep 0.1; ' +
    'done';

  const output = execFileSync('ssh', ['-o', 'BatchMode=yes', remote, startCmd], {
    encoding: 'utf8',
  }).trim();

  if (!output) {
    throw new Error('Remote server did not print PORT:TOKEN within timeout');
  }

  const colonIdx = output.indexOf(':');
  if (colonIdx === -1) {
    throw new Error('Unexpected remote output (expected PORT:TOKEN): ' + output);
  }

  const port = parseInt(output.slice(0, colonIdx), 10);
  const token = output.slice(colonIdx + 1);

  if (!port || !token) {
    throw new Error('Failed to parse PORT:TOKEN from: ' + output);
  }

  // Step 3: Print result as JSON so preload.js can parse it
  process.stdout.write(JSON.stringify({ port, token, remoteCwd }) + '\n');
} catch (err) {
  process.stderr.write('pi-bridge setup failed: ' + err.message + '\n');
  process.exit(1);
}
