'use strict';

/**
 * preload.js — Entry point for pi-bridge, loaded via node --require.
 *
 * When --ssh is not present in process.argv, this module is a no-op so that
 * pi can still be used locally without the bridge.
 *
 * Orchestration (all synchronous from the caller's perspective):
 *   1. Parse + strip --ssh user@host:/path from process.argv
 *   2. spawnSync setup.js to upload + start remote server → { port, token, remoteCwd }
 *   3. Create fake local directory skeleton
 *   4. process.chdir to fake local cwd
 *   5. Spawn SSH tunnel (local:port → remote:port)
 *   6. Patch fs.* to intercept fake-root paths
 *   7. Register cleanup handler on process exit
 */

const { spawnSync } = require('child_process');
const path = require('path');

const { parseAndStripSshArg } = require('./argv');
const { createFakeDir } = require('./fake-dir');
const { startTunnel } = require('./tunnel');
const { patchFs } = require('./fs-patch');
const { patchChildProcess } = require('./child-process-patch');
const { registerCleanup } = require('./cleanup');

// --- Step 1: Parse --ssh flag ---
const sshArg = parseAndStripSshArg();
if (!sshArg) {
  // No --ssh flag → run pi locally, bridge is inactive
  return;
}

const { remote, remoteCwd } = sshArg;

// --- Step 2: Upload + start remote server via setup.js ---
const setupScript = path.join(__dirname, 'setup.js');
const setupResult = spawnSync(process.execPath, [setupScript, remote, remoteCwd], {
  encoding: 'utf8',
  timeout: 30000, // 30 seconds
});

if (setupResult.status !== 0) {
  const errMsg = (setupResult.stderr || '').trim() || 'setup.js exited with status ' + setupResult.status;
  throw new Error('pi-bridge: ' + errMsg);
}

let config;
try {
  config = JSON.parse(setupResult.stdout.trim());
} catch (e) {
  throw new Error('pi-bridge: Failed to parse setup output: ' + setupResult.stdout);
}

const { port, token } = config;

// --- Step 3: Create fake local directory ---
const { fakeRoot, fakeLocalCwd } = createFakeDir(remoteCwd);

// --- Step 4: Change working directory to fake local cwd ---
process.chdir(fakeLocalCwd);

// --- Step 5: Start SSH tunnel ---
const tunnelProcess = startTunnel(remote, port);

// --- Step 6: Patch fs.* and child_process ---
patchFs(fakeRoot, port, token);
patchChildProcess(fakeRoot, remote);

// --- Step 7: Register cleanup ---
registerCleanup({ fakeRoot, tunnelProcess, remote });
