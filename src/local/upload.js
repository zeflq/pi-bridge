'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Root of the pi-bridge project (two levels up from src/local/)
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Read the remote source files and bundle them into a single self-contained
 * CommonJS script.
 *
 * Each file's code is inlined directly — module.exports lines are removed,
 * and const/let declarations are converted to var so they hoist to the
 * top-level scope and are accessible by later files in the bundle.
 *
 * Dependency order:
 *   1. shared/protocol.js  → exports: ENDPOINTS, TOKEN_HEADER, ERRORS
 *   2. remote/auth.js      → exports: generateToken, createAuthMiddleware
 *   3. remote/guard.js     → exports: createGuard
 *   4. remote/handlers.js  → exports: createHandlers
 *   5. remote/index.js     → entry point (no exports)
 *
 * @returns {string} The bundled script as a string
 */
function buildBundle() {
  const files = [
    path.join(PROJECT_ROOT, 'src', 'shared', 'protocol.js'),
    path.join(PROJECT_ROOT, 'src', 'remote', 'auth.js'),
    path.join(PROJECT_ROOT, 'src', 'remote', 'guard.js'),
    path.join(PROJECT_ROOT, 'src', 'remote', 'handlers.js'),
    path.join(PROJECT_ROOT, 'src', 'remote', 'index.js'),
  ];

  const parts = ["'use strict';\n"];

  for (const filePath of files) {
    let src = fs.readFileSync(filePath, 'utf8');

    // 1. Remove 'use strict' — we add one at the top
    src = src.replace(/^'use strict';\n?/gm, '');

    // 2. Remove module.exports = { ... }; lines entirely
    src = src.replace(/^module\.exports\s*=\s*\{[^}]+\};\s*\n?/gm, '');

    // 3. Replace top-level const/let declarations with var so they hoist
    //    to the bundle's top-level scope. Only replace declarations that
    //    are at the start of a line (top-level, not inside functions/blocks).
    src = src.replace(/^const\s+/gm, 'var ');
    src = src.replace(/^let\s+/gm, 'var ');

    parts.push('// --- ' + path.basename(filePath) + ' ---');
    parts.push(src.trim());
    parts.push('');
  }

  return parts.join('\n');
}

/**
 * Upload the bundled remote server script to the remote machine via SSH.
 * Uses base64 encoding to safely transfer content over the shell.
 *
 * @param {string} remote     - SSH target, e.g. 'user@host'
 * @param {string} [destPath] - Remote destination path (default: /tmp/pi-bridge-server.js)
 */
function uploadBundle(remote, destPath) {
  destPath = destPath || '/tmp/pi-bridge-server.js';
  const bundle = buildBundle();
  const encoded = Buffer.from(bundle, 'utf8').toString('base64');

  // Use printf to write the base64 string then pipe through base64 -d
  const cmd = "printf '%s' '" + encoded + "' | base64 -d > " + destPath;

  execFileSync('ssh', ['-o', 'BatchMode=yes', remote, cmd], {
    encoding: 'utf8',
  });
}

module.exports = { buildBundle, uploadBundle };
