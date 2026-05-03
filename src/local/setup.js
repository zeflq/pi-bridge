'use strict';

/**
 * setup.js — Orchestrator called via spawnSync from preload.js
 *
 * Usage: node setup.js <remote> <remoteCwd>
 *
 * Steps:
 *   1. Upload the bundled remote server script via SSH
 *   2. Start the server on the remote (background process + poll for output)
 *   3. Parse PORT:TOKEN:PID from remote stdout
 *   4. Print { port, token, remoteCwd, sessionId, remotePid } as JSON to stdout
 *
 * Each session gets a unique ID to isolate its log file, preventing races
 * when multiple pi sessions target the same remote working directory.
 */

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { uploadBundle } = require('./upload');

const remote = process.argv[2];
const remoteCwd = process.argv[3];

if (!remote || !remoteCwd) {
  process.stderr.write('Usage: node setup.js <remote> <remoteCwd>\n');
  process.exit(1);
}

const REMOTE_SCRIPT = '/tmp/pi-bridge-server.js';

// Unique per-session log file — prevents races when multiple sessions
// target the same remote working directory simultaneously.
const sessionId = crypto.randomBytes(4).toString('hex');
const REMOTE_LOG = '/tmp/pi-bridge-out-' + sessionId + '.txt';

try {
  // Step 1: Upload the bundled server script
  uploadBundle(remote, REMOTE_SCRIPT);

  // Step 2: Start server in background on remote.
  // The server prints "PORT:TOKEN:PID\n" on startup then stays alive.
  // We poll the session-unique log file to avoid racing with other sessions.
  const startCmd =
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
    throw new Error('Remote server did not print PORT:TOKEN:PID within timeout');
  }

  const parts = output.split(':');
  if (parts.length < 3) {
    throw new Error('Unexpected remote output (expected PORT:TOKEN:PID): ' + output);
  }

  const port = parseInt(parts[0], 10);
  const token = parts[1];
  const remotePid = parseInt(parts[2], 10);

  if (!port || !token || !remotePid) {
    throw new Error('Failed to parse PORT:TOKEN:PID from: ' + output);
  }

  // Step 3: Print result as JSON so preload.js can parse it
  process.stdout.write(JSON.stringify({ port, token, remoteCwd, sessionId, remotePid }) + '\n');
} catch (err) {
  process.stderr.write('pi-bridge setup failed: ' + err.message + '\n');
  process.exit(1);
}
