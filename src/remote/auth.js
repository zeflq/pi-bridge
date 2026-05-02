'use strict';

const crypto = require('crypto');

/**
 * Generate a cryptographically random token.
 * @returns {string} 64-character hex string
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create an auth middleware that validates the x-token header.
 * Returns a function (req, res, next) that calls next() on success or
 * writes 401 on failure.
 *
 * @param {string} token - The expected token value
 * @returns {function(req, res, next): void}
 */
function createAuthMiddleware(token) {
  return function authMiddleware(req, res, next) {
    const provided = req.headers['x-token'];
    if (!provided || provided !== token) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized');
      return;
    }
    next();
  };
}

module.exports = { generateToken, createAuthMiddleware };
