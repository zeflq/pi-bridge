'use strict';

const fs = require('fs');

/**
 * Collect full request body as a string.
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Send a JSON error response.
 */
function sendError(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

/**
 * Create the file operation handler function.
 * Expects URL parsing to have already happened by the time this is called.
 *
 * @returns {function(req, res): void} - Express-style handler (no next, terminal)
 */
function createHandlers() {
  return async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;

    try {
      if (req.method === 'GET' && pathname === '/list') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        const withTypes = url.searchParams.get('withFileTypes') === '1';
        if (withTypes) {
          const dirents = fs.readdirSync(p, { withFileTypes: true });
          const result = dirents.map(d => ({
            name: d.name,
            isFile: d.isFile(),
            isDirectory: d.isDirectory(),
            isSymbolicLink: d.isSymbolicLink(),
          }));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } else {
          const entries = fs.readdirSync(p);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(entries));
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/read') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        const content = fs.readFileSync(p, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(content);
        return;
      }

      if (req.method === 'GET' && pathname === '/exists') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        const exists = fs.existsSync(p);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(exists ? '1' : '0');
        return;
      }

      if (req.method === 'GET' && pathname === '/liststat') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        const dirents = fs.readdirSync(p, { withFileTypes: true });
        const result = dirents.map(d => {
          let mtimeMs = 0;
          try { mtimeMs = fs.statSync(require('path').join(p, d.name)).mtimeMs; } catch (_) {}
          return { name: d.name, isFile: d.isFile(), isDirectory: d.isDirectory(), mtimeMs };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      if (req.method === 'GET' && pathname === '/stat') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        const st = fs.statSync(p);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          isFile: st.isFile(),
          isDirectory: st.isDirectory(),
          size: st.size,
          mtimeMs: st.mtimeMs,
        }));
        return;
      }

      if (req.method === 'POST' && pathname === '/write') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        const body = await collectBody(req);
        fs.writeFileSync(p, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      if (req.method === 'POST' && pathname === '/mkdir') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        fs.mkdirSync(p, { recursive: true });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      if (req.method === 'POST' && pathname === '/delete') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        fs.unlinkSync(p);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      if (req.method === 'POST' && pathname === '/rename') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        if (!from || !to) return sendError(res, 400, 'Missing from or to parameter');
        fs.renameSync(from, to);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      if (req.method === 'POST' && pathname === '/rm') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        const recursive = url.searchParams.get('recursive') === '1';
        fs.rmSync(p, { recursive, force: true });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      if (req.method === 'POST' && pathname === '/copy') {
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');
        if (!from || !to) return sendError(res, 400, 'Missing from or to parameter');
        fs.copyFileSync(from, to);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      if (req.method === 'POST' && pathname === '/append') {
        const p = url.searchParams.get('path');
        if (!p) return sendError(res, 400, 'Missing path parameter');
        const body = await collectBody(req);
        fs.appendFileSync(p, body, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
      }

      // Unknown endpoint
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    } catch (err) {
      if (err.code === 'ENOENT') {
        sendError(res, 404, 'Not found: ' + err.message);
      } else {
        sendError(res, 500, 'Internal error: ' + err.message);
      }
    }
  };
}

module.exports = { createHandlers };
