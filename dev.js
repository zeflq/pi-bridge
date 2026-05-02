'use strict';

/**
 * dev.js — Development entry point for pi-bridge.
 *
 * Reads SSH_TARGET env var and runs preload + dummy integration app.
 *
 * Usage:
 *   SSH_TARGET=user@host:/path node dev.js
 */

const sshTarget = process.env.SSH_TARGET;
if (!sshTarget) {
  console.error('Error: SSH_TARGET environment variable is required.');
  console.error('Example: SSH_TARGET=user@host:/root/project node dev.js');
  process.exit(1);
}

// Inject --ssh flag so preload.js picks it up
process.argv.push('--ssh', sshTarget);

// Run preload (patches fs, changes cwd, etc.)
require('./src/local/preload');

// Run the dummy integration app
require('./test/integration/app');
