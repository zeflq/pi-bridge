'use strict';

/**
 * Dummy integration app that exercises the bridge transparently.
 * Loaded after preload.js has patched fs and changed cwd.
 *
 * Intended usage:
 *   node --require ./src/local/preload.js ./test/integration/app.js --ssh user@host:/path
 */

const fs = require('fs');
const path = require('path');

console.log('cwd:', process.cwd());

try {
  const entries = fs.readdirSync(process.cwd());
  console.log('dir listing:', entries);
} catch (err) {
  console.error('readdirSync failed:', err.message);
}

const agentsPath = path.join(process.cwd(), 'AGENTS.md');
try {
  const exists = fs.existsSync(agentsPath);
  console.log('AGENTS.md exists:', exists);
  if (exists) {
    const content = fs.readFileSync(agentsPath, 'utf8');
    console.log('AGENTS.md (first 200 chars):', content.slice(0, 200));
  }
} catch (err) {
  console.error('readFileSync failed:', err.message);
}
