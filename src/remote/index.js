'use strict';

// NOTE: This file is bundled by upload.js into a single self-contained script.
// All dependencies (auth, guard, handlers) are inlined — no cross-file requires here.

const http = require('http');

// These symbols are provided by the bundle (inlined by upload.js):
//   generateToken, createAuthMiddleware  — from auth.js
//   createGuard                          — from guard.js
//   createHandlers                       — from handlers.js

function startServer(remoteCwd) {
  const token = generateToken();
  const authMiddleware = createAuthMiddleware(token);
  const guardMiddleware = createGuard(remoteCwd);
  const handleRequest = createHandlers();

  const server = http.createServer((req, res) => {
    authMiddleware(req, res, () => {
      guardMiddleware(req, res, () => {
        handleRequest(req, res);
      });
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    // Print PORT:TOKEN to stdout so the local preload can capture it
    process.stdout.write(port + ':' + token + '\n');
  });

  return server;
}

const remoteCwd = process.argv[2];
if (!remoteCwd) {
  process.stderr.write('Usage: node index.js <remoteCwd>\n');
  process.exit(1);
}

startServer(remoteCwd);
