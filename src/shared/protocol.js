'use strict';

const ENDPOINTS = {
  list: '/list',
  read: '/read',
  exists: '/exists',
  write: '/write',
  mkdir: '/mkdir',
  delete: '/delete',
  rename: '/rename',
};

const TOKEN_HEADER = 'x-token';

const ERRORS = {
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
};

module.exports = { ENDPOINTS, TOKEN_HEADER, ERRORS };
