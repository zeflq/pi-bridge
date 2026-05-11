'use strict';

const { execFileSync } = require('child_process');

/**
 * Synchronous HTTP GET to the local file server.
 *
 * The child process writes a JSON envelope to stdout:
 *   { ok: true,  body: "..." }
 *   { ok: false, status: 403, body: "..." }
 *
 * This keeps ALL output on stdout so execFileSync can capture it with
 * stdio:'pipe', preventing HTTP error text from leaking into the terminal.
 *
 * @param {number} port    - Server port (127.0.0.1)
 * @param {string} token   - Auth token for x-token header
 * @param {string} urlPath - URL path + query string, e.g. '/list?path=%2Froot'
 * @returns {string}       - Response body as a UTF-8 string
 * @throws                 - On HTTP errors or non-2xx status codes
 */
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 600;

/**
 * Run execFileSync with retries when the tunnel is reconnecting after sleep/wake.
 * ECONNREFUSED (status 0, body contains "ECONNREFUSED") means the tunnel is not
 * yet back up — wait and retry.
 */
function defaultSleep() {
  try {
    execFileSync(process.execPath, ['-e', `setTimeout(()=>{},${RETRY_DELAY_MS})`], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (_) {}
}

/**
 * @param {() => string} fn    - Returns a JSON envelope string
 * @param {() => void}  sleep  - Injected sleep (defaults to real delay; override in tests)
 */
function withRetry(fn, sleep) {
  sleep = sleep || defaultSleep;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const raw = fn();
    const result = JSON.parse(raw);
    const isConnRefused = !result.ok && result.status === 0 &&
      typeof result.body === 'string' && result.body.includes('ECONNREFUSED');
    if (!isConnRefused || attempt === MAX_RETRIES) return raw;
    sleep();
  }
}

function httpGet(port, token, urlPath) {
  const script = `
const http = require('http');
let body = '';
let statusCode = 0;
const req = http.get(
  { hostname:'127.0.0.1', port:${JSON.stringify(port)}, path:${JSON.stringify(urlPath)},
    headers:{'x-token':${JSON.stringify(token)}} },
  (res) => {
    statusCode = res.statusCode;
    res.setEncoding('utf8');
    res.on('data', (d) => { body += d; });
    res.on('end', () => {
      process.stdout.write(JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, body }));
    });
  }
);
req.on('error', (e) => {
  process.stdout.write(JSON.stringify({ ok: false, status: 0, body: e.message }));
});
`;
  const raw = withRetry(() => execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
  const result = JSON.parse(raw);
  if (!result.ok) {
    const err = new Error('HTTP ' + result.status + ': ' + result.body);
    err.statusCode = result.status;
    throw err;
  }
  return result.body;
}

/**
 * Synchronous HTTP POST to the local file server.
 *
 * @param {number} port    - Server port (127.0.0.1)
 * @param {string} token   - Auth token for x-token header
 * @param {string} urlPath - URL path + query string
 * @param {string} body    - Request body (UTF-8 string)
 * @returns {string}       - Response body
 * @throws                 - On HTTP errors or non-2xx status codes
 */
function httpPost(port, token, urlPath, body) {
  // Body is passed via stdin (not embedded in the script) to avoid ENAMETOOLONG
  // on Windows when writing large files such as session exports.
  const script = `
const http = require('http');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  const bodyBuf = Buffer.from(raw, 'utf8');
  let resBody = '';
  let statusCode = 0;
  const req = http.request(
    { method:'POST', hostname:'127.0.0.1', port:${JSON.stringify(port)}, path:${JSON.stringify(urlPath)},
      headers:{'x-token':${JSON.stringify(token)},'Content-Type':'text/plain; charset=utf-8','Content-Length':bodyBuf.length} },
    (res) => {
      statusCode = res.statusCode;
      res.setEncoding('utf8');
      res.on('data', (d) => { resBody += d; });
      res.on('end', () => {
        process.stdout.write(JSON.stringify({ ok: statusCode >= 200 && statusCode < 300, status: statusCode, body: resBody }));
      });
    }
  );
  req.on('error', (e) => {
    process.stdout.write(JSON.stringify({ ok: false, status: 0, body: e.message }));
  });
  req.write(bodyBuf);
  req.end();
});
`;
  const raw = withRetry(() => execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: body }));
  const result = JSON.parse(raw);
  if (!result.ok) {
    const err = new Error('HTTP ' + result.status + ': ' + result.body);
    err.statusCode = result.status;
    throw err;
  }
  return result.body;
}

module.exports = { httpGet, httpPost, _withRetry: withRetry, _MAX_RETRIES: MAX_RETRIES };
