'use strict';

const path = require('path');

/**
 * Create a path guard middleware that restricts access to files within remoteCwd.
 * Resolves the path from the query parameter 'path' (or 'from' for rename).
 * Sends 403 if the resolved path is outside remoteCwd.
 *
 * @param {string} remoteCwd - Absolute path on the remote that is the allowed root
 * @returns {function(req, res, next): void}
 */
function createGuard(remoteCwd) {
  const normalizedCwd = path.resolve(remoteCwd);

  return function guardMiddleware(req, res, next) {
    const url = new URL(req.url, 'http://localhost');
    // For rename we need to check both 'from' and 'to'
    const pathsToCheck = [];

    const p = url.searchParams.get('path');
    if (p !== null) pathsToCheck.push(p);

    const from = url.searchParams.get('from');
    if (from !== null) pathsToCheck.push(from);

    const to = url.searchParams.get('to');
    if (to !== null) pathsToCheck.push(to);

    // If no path params provided, let handler deal with it (will likely 400)
    if (pathsToCheck.length === 0) {
      next();
      return;
    }

    for (const p of pathsToCheck) {
      const resolved = path.resolve(p);
      if (!resolved.startsWith(normalizedCwd + path.sep) && resolved !== normalizedCwd) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('Forbidden');
        return;
      }
    }

    next();
  };
}

module.exports = { createGuard };
