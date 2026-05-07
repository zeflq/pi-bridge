'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const path = require('path');
const { isFakePath, toRemotePath } = require('./path-mapper');
const { httpGet, httpPost } = require('./http-client');

/**
 * Patch Node.js built-in fs methods to intercept calls on fake-root paths
 * and redirect them to the remote file server.
 *
 * Covers both sync (readFileSync, readdirSync, …) and async (fs.promises.*)
 * variants so that both pi's startup resource loading and its read tool work.
 *
 * Non-fake paths are forwarded to the original fs implementations unchanged.
 *
 * @param {string} fakeRoot - Local fake root directory (real path, no symlinks)
 * @param {number} port     - Remote file server port (127.0.0.1)
 * @param {string} token    - Auth token
 */

// --- Error helpers ---

function makeEnoent(p, syscall) {
  syscall = syscall || 'open';
  return Object.assign(
    new Error("ENOENT: no such file or directory, " + syscall + " '" + p + "'"),
    { code: 'ENOENT', syscall, path: p }
  );
}

function makeEisdir(p) {
  return Object.assign(
    new Error("EISDIR: illegal operation on a directory, read"),
    { code: 'EISDIR', syscall: 'read', path: p }
  );
}

/**
 * Returns true if the path looks like a bash executable.
 * Used on Windows to fake bash presence so pi's shell-detection passes.
 */
function isBashPath(p) {
  const n = String(p).replace(/\\/g, '/').toLowerCase();
  return n.endsWith('/bash.exe') || n.endsWith('/bash') || n === '/bin/bash';
}

function rethrowRemote(e, p) {
  if (!e || !e.message) throw e;
  if (e.message.includes('403')) throw makeEnoent(p);
  if (e.message.includes('EISDIR')) throw makeEisdir(p);
  if (e.message.includes('ENOENT')) throw makeEnoent(p);
  throw e;
}

// --- Async HTTP helper (used for fs.promises patching) ---

function httpGetAsync(port, token, urlPath) {
  return new Promise(function(resolve, reject) {
    const req = http.get(
      { hostname: '127.0.0.1', port: port, path: urlPath, headers: { 'x-token': token } },
      function(res) {
        var body = '';
        res.setEncoding('utf8');
        res.on('data', function(d) { body += d; });
        res.on('end', function() {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            var err = new Error('HTTP ' + res.statusCode + ': ' + body);
            err.statusCode = res.statusCode;
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
  });
}

function patchFs(fakeRoot, port, token) {
  // --- Sync originals ---
  const orig = {
    readdirSync:    fs.readdirSync.bind(fs),
    readFileSync:   fs.readFileSync.bind(fs),
    existsSync:     fs.existsSync.bind(fs),
    accessSync:     fs.accessSync.bind(fs),
    statSync:       fs.statSync.bind(fs),
    lstatSync:      fs.lstatSync.bind(fs),
    writeFileSync:  fs.writeFileSync.bind(fs),
    appendFileSync: fs.appendFileSync.bind(fs),
    mkdirSync:      fs.mkdirSync.bind(fs),
    rmSync:         fs.rmSync.bind(fs),
    unlinkSync:     fs.unlinkSync.bind(fs),
    renameSync:     fs.renameSync.bind(fs),
    copyFileSync:   fs.copyFileSync.bind(fs),
    realpathSync:   fs.realpathSync.bind(fs),
    createWriteStream: fs.createWriteStream.bind(fs),
    createReadStream:  fs.createReadStream.bind(fs),
  };

  // --- Async (promises) originals ---
  const origP = {
    access:     fs.promises.access.bind(fs.promises),
    readFile:   fs.promises.readFile.bind(fs.promises),
    readdir:    fs.promises.readdir.bind(fs.promises),
    stat:       fs.promises.stat.bind(fs.promises),
    lstat:      fs.promises.lstat.bind(fs.promises),
    writeFile:  fs.promises.writeFile.bind(fs.promises),
    appendFile: fs.promises.appendFile.bind(fs.promises),
    mkdir:      fs.promises.mkdir.bind(fs.promises),
    rm:         fs.promises.rm.bind(fs.promises),
    unlink:     fs.promises.unlink.bind(fs.promises),
    rename:     fs.promises.rename.bind(fs.promises),
    copyFile:   fs.promises.copyFile.bind(fs.promises),
    open:       fs.promises.open.bind(fs.promises),
  };

  // Resolve any path (relative or absolute) to absolute before checking fake root
  function abs(p) {
    return typeof p === 'string' ? path.resolve(p) : null;
  }

  function rpath(fakePath) {
    return toRemotePath(fakePath, fakeRoot);
  }

  // Build a minimal fs.Stats-like object from the remote /stat response
  function makeStats(info) {
    return {
      isFile:            function() { return info.isFile; },
      isDirectory:       function() { return info.isDirectory; },
      isSymbolicLink:    function() { return false; },
      isBlockDevice:     function() { return false; },
      isCharacterDevice: function() { return false; },
      isFIFO:            function() { return false; },
      isSocket:          function() { return false; },
      size:    info.size,
      mtimeMs: info.mtimeMs,
      mtime:   new Date(info.mtimeMs),
      mode:    info.isDirectory ? 0o40755 : 0o100644,
      nlink:   1,
      uid: 0, gid: 0, dev: 0, ino: 0, rdev: 0, blksize: 4096, blocks: 0,
      atime: new Date(info.mtimeMs), ctime: new Date(info.mtimeMs), birthtime: new Date(info.mtimeMs),
      atimeMs: info.mtimeMs, ctimeMs: info.mtimeMs, birthtimeMs: info.mtimeMs,
    };
  }

  // ── Sync patches ────────────────────────────────────────────────────────────

  fs.readdirSync = function patchedReaddirSync(p, opts) {
    const s = abs(p) || p.toString();
    if (!isFakePath(s, fakeRoot)) return orig.readdirSync(p, opts);
    try {
      const withFileTypes = opts && opts.withFileTypes;
      const qs = '/list?path=' + encodeURIComponent(rpath(s)) + (withFileTypes ? '&withFileTypes=1' : '');
      const parsed = JSON.parse(httpGet(port, token, qs));
      if (!withFileTypes) return parsed;
      return parsed.map(function(e) {
        return {
          name: e.name,
          isFile:            function() { return e.isFile; },
          isDirectory:       function() { return e.isDirectory; },
          isSymbolicLink:    function() { return e.isSymbolicLink; },
          isBlockDevice:     function() { return false; },
          isCharacterDevice: function() { return false; },
          isFIFO:            function() { return false; },
          isSocket:          function() { return false; },
        };
      });
    } catch (e) { rethrowRemote(e, s); }
  };

  fs.readFileSync = function patchedReadFileSync(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.readFileSync(p, opts);
    try {
      const body = httpGet(port, token, '/read?path=' + encodeURIComponent(rpath(s)));
      const enc = typeof opts === 'string' ? opts : (opts && opts.encoding);
      return enc ? body : Buffer.from(body, 'utf8');
    } catch (e) { rethrowRemote(e, s); }
  };

  fs.existsSync = function patchedExistsSync(p) {
    const s = abs(p);
    // On Windows, pi checks for bash locally before using the shell tool.
    // The check never reaches our SSH bridge (it's just an existsSync call).
    // Fake it so pi believes bash is available; the actual spawn is intercepted
    // and the Windows exe path is normalised to 'bash' before going over SSH.
    if (process.platform === 'win32' && isBashPath(s)) return true;
    if (!s || !isFakePath(s, fakeRoot)) return orig.existsSync(p);
    try {
      const remoteExists = httpGet(port, token, '/exists?path=' + encodeURIComponent(rpath(s))).trim() === '1';
      // Also check locally: the fake dir root always exists on disk (pi-bridge
      // creates it in preload). This lets pi's session-cwd check pass even when
      // Node.js 24's ESM existsSync bypasses our patch and the remote check
      // returns an unexpected result for the project root directory.
      return remoteExists || orig.existsSync(p);
    } catch (e) {
      if (e.message && (e.message.includes('403') || e.message.includes('ENOENT'))) return false;
      return orig.existsSync(p);
    }
  };

  fs.accessSync = function patchedAccessSync(p, mode) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.accessSync(p, mode);
    try {
      const exists = httpGet(port, token, '/exists?path=' + encodeURIComponent(rpath(s))).trim() === '1';
      if (!exists) throw makeEnoent(s, 'access');
    } catch (e) {
      if (e.code === 'ENOENT') throw e;
      if (e.message && e.message.includes('403')) throw makeEnoent(s, 'access');
      throw e;
    }
  };

  fs.statSync = function patchedStatSync(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.statSync(p, opts);
    try {
      return makeStats(JSON.parse(httpGet(port, token, '/stat?path=' + encodeURIComponent(rpath(s)))));
    } catch (e) { rethrowRemote(e, s); }
  };

  fs.lstatSync = function patchedLstatSync(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.lstatSync(p, opts);
    try {
      return makeStats(JSON.parse(httpGet(port, token, '/stat?path=' + encodeURIComponent(rpath(s)))));
    } catch (e) { rethrowRemote(e, s); }
  };

  fs.writeFileSync = function patchedWriteFileSync(p, data, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.writeFileSync(p, data, opts);
    const content = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    httpPost(port, token, '/write?path=' + encodeURIComponent(rpath(s)), content);
  };

  fs.mkdirSync = function patchedMkdirSync(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.mkdirSync(p, opts);
    httpPost(port, token, '/mkdir?path=' + encodeURIComponent(rpath(s)), '');
  };

  fs.unlinkSync = function patchedUnlinkSync(p) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.unlinkSync(p);
    httpPost(port, token, '/delete?path=' + encodeURIComponent(rpath(s)), '');
  };

  fs.renameSync = function patchedRenameSync(from, to) {
    const fromS = abs(from);
    const toS   = abs(to);
    if (!fromS || !isFakePath(fromS, fakeRoot)) return orig.renameSync(from, to);
    httpPost(port, token,
      '/rename?from=' + encodeURIComponent(rpath(fromS)) + '&to=' + encodeURIComponent(toS ? rpath(toS) : to.toString()),
      '');
  };

  fs.appendFileSync = function patchedAppendFileSync(p, data, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.appendFileSync(p, data, opts);
    const content = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    httpPost(port, token, '/append?path=' + encodeURIComponent(rpath(s)), content);
  };

  fs.rmSync = function patchedRmSync(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.rmSync(p, opts);
    const recursive = (opts && opts.recursive) ? '1' : '0';
    httpPost(port, token, '/rm?path=' + encodeURIComponent(rpath(s)) + '&recursive=' + recursive, '');
  };

  fs.copyFileSync = function patchedCopyFileSync(src, dest) {
    const srcS  = abs(src);
    const destS = abs(dest);
    if (!srcS || !isFakePath(srcS, fakeRoot)) return orig.copyFileSync(src, dest);
    httpPost(port, token,
      '/copy?from=' + encodeURIComponent(rpath(srcS)) + '&to=' + encodeURIComponent(destS ? rpath(destS) : dest.toString()),
      '');
  };

  // realpathSync: fake paths are already real absolute paths (no symlinks in skeleton)
  fs.realpathSync = function patchedRealpathSync(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.realpathSync(p, opts);
    return s;
  };
  fs.realpathSync.native = function(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return orig.realpathSync.native ? orig.realpathSync.native(p, opts) : orig.realpathSync(p, opts);
    return s;
  };

  // createReadStream: read entire file from remote, pipe as stream
  fs.createReadStream = function patchedCreateReadStream(p, opts) {
    const s = typeof p === 'string' ? abs(p) : null;
    if (!s || !isFakePath(s, fakeRoot)) return orig.createReadStream(p, opts);
    const { Readable } = require('stream');
    const stream = new Readable({ read() {} });
    // Fetch async, push into stream
    httpGetAsync(port, token, '/read?path=' + encodeURIComponent(rpath(s)))
      .then(function(body) { stream.push(body); stream.push(null); })
      .catch(function(e) { stream.destroy(e); });
    return stream;
  };

  // createWriteStream: buffer writes, POST on finish
  fs.createWriteStream = function patchedCreateWriteStream(p, opts) {
    const s = typeof p === 'string' ? abs(p) : null;
    if (!s || !isFakePath(s, fakeRoot)) return orig.createWriteStream(p, opts);
    const { Writable } = require('stream');
    const chunks = [];
    return new Writable({
      write(chunk, enc, cb) { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, enc)); cb(); },
      final(cb) {
        const content = Buffer.concat(chunks).toString('utf8');
        try { httpPost(port, token, '/write?path=' + encodeURIComponent(rpath(s)), content); cb(); }
        catch(e) { cb(e); }
      },
    });
  };

  // ── Async (fs.promises) patches ─────────────────────────────────────────────

  fs.promises.access = async function patchedAccess(p, mode) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return origP.access(p, mode);
    try {
      const exists = (await httpGetAsync(port, token, '/exists?path=' + encodeURIComponent(rpath(s)))).trim() === '1';
      if (!exists) throw makeEnoent(s, 'access');
    } catch (e) {
      if (e.code === 'ENOENT') throw e;
      if (e.statusCode === 403 || (e.message && e.message.includes('403'))) throw makeEnoent(s, 'access');
      throw e;
    }
  };

  fs.promises.readFile = async function patchedReadFile(p, opts) {
    const s = typeof p === 'string' ? abs(p) : null;
    if (!s || !isFakePath(s, fakeRoot)) return origP.readFile(p, opts);
    try {
      const body = await httpGetAsync(port, token, '/read?path=' + encodeURIComponent(rpath(s)));
      const enc = typeof opts === 'string' ? opts : (opts && opts.encoding);
      return enc ? body : Buffer.from(body, 'utf8');
    } catch (e) {
      if (e.statusCode === 403 || (e.message && e.message.includes('403'))) throw makeEnoent(s);
      if (e.message && e.message.includes('EISDIR')) throw makeEisdir(s);
      throw e;
    }
  };

  fs.promises.readdir = async function patchedReaddir(p, opts) {
    const s = typeof p === 'string' ? abs(p) : p.toString();
    if (!isFakePath(s, fakeRoot)) return origP.readdir(p, opts);
    try {
      const withFileTypes = opts && opts.withFileTypes;
      const qs = '/list?path=' + encodeURIComponent(rpath(s)) + (withFileTypes ? '&withFileTypes=1' : '');
      const parsed = JSON.parse(await httpGetAsync(port, token, qs));
      if (!withFileTypes) return parsed;
      return parsed.map(function(e) {
        return {
          name: e.name,
          isFile:            function() { return e.isFile; },
          isDirectory:       function() { return e.isDirectory; },
          isSymbolicLink:    function() { return e.isSymbolicLink; },
          isBlockDevice:     function() { return false; },
          isCharacterDevice: function() { return false; },
          isFIFO:            function() { return false; },
          isSocket:          function() { return false; },
        };
      });
    } catch (e) {
      if (e.statusCode === 403 || (e.message && e.message.includes('403'))) throw makeEnoent(s);
      throw e;
    }
  };
  fsp.readdir = fs.promises.readdir;

  fs.promises.stat = async function patchedStat(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return origP.stat(p, opts);
    try {
      return makeStats(JSON.parse(await httpGetAsync(port, token, '/stat?path=' + encodeURIComponent(rpath(s)))));
    } catch (e) {
      if (e.statusCode === 403 || (e.message && e.message.includes('403'))) throw makeEnoent(s);
      throw e;
    }
  };

  fs.promises.lstat = async function patchedLstat(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return origP.lstat(p, opts);
    try {
      return makeStats(JSON.parse(await httpGetAsync(port, token, '/stat?path=' + encodeURIComponent(rpath(s)))));
    } catch (e) {
      if (e.statusCode === 403 || (e.message && e.message.includes('403'))) throw makeEnoent(s);
      throw e;
    }
  };

  fs.promises.writeFile = async function patchedWriteFile(p, data, opts) {
    const s = typeof p === 'string' ? abs(p) : null;
    if (!s || !isFakePath(s, fakeRoot)) return origP.writeFile(p, data, opts);
    const content = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    await new Promise(function(resolve, reject) {
      const body = Buffer.from(content, 'utf8');
      const req = http.request(
        { method: 'POST', hostname: '127.0.0.1', port: port,
          path: '/write?path=' + encodeURIComponent(rpath(s)),
          headers: { 'x-token': token, 'Content-Length': body.length } },
        function(res) {
          res.resume();
          res.on('end', function() { res.statusCode < 300 ? resolve() : reject(new Error('HTTP ' + res.statusCode)); });
        }
      );
      req.on('error', reject);
      req.end(body);
    });
  };

  fs.promises.mkdir = async function patchedMkdir(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return origP.mkdir(p, opts);
    await new Promise(function(resolve, reject) {
      const req = http.request(
        { method: 'POST', hostname: '127.0.0.1', port: port,
          path: '/mkdir?path=' + encodeURIComponent(rpath(s)),
          headers: { 'x-token': token, 'Content-Length': 0 } },
        function(res) {
          res.resume();
          res.on('end', function() { res.statusCode < 300 ? resolve() : reject(new Error('HTTP ' + res.statusCode)); });
        }
      );
      req.on('error', reject);
      req.end();
    });
  };

  fs.promises.unlink = async function patchedUnlink(p) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return origP.unlink(p);
    await new Promise(function(resolve, reject) {
      const req = http.request(
        { method: 'POST', hostname: '127.0.0.1', port: port,
          path: '/delete?path=' + encodeURIComponent(rpath(s)),
          headers: { 'x-token': token, 'Content-Length': 0 } },
        function(res) { res.resume(); res.on('end', function() { res.statusCode < 300 ? resolve() : reject(new Error('HTTP ' + res.statusCode)); }); }
      );
      req.on('error', reject); req.end();
    });
  };

  fs.promises.appendFile = async function patchedAppendFile(p, data, opts) {
    const s = typeof p === 'string' ? abs(p) : null;
    if (!s || !isFakePath(s, fakeRoot)) return origP.appendFile(p, data, opts);
    const content = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    const buf = Buffer.from(content, 'utf8');
    await new Promise(function(resolve, reject) {
      const req = http.request(
        { method: 'POST', hostname: '127.0.0.1', port: port,
          path: '/append?path=' + encodeURIComponent(rpath(s)),
          headers: { 'x-token': token, 'Content-Length': buf.length } },
        function(res) { res.resume(); res.on('end', function() { res.statusCode < 300 ? resolve() : reject(new Error('HTTP ' + res.statusCode)); }); }
      );
      req.on('error', reject); req.end(buf);
    });
  };

  fs.promises.rm = async function patchedRm(p, opts) {
    const s = abs(p);
    if (!s || !isFakePath(s, fakeRoot)) return origP.rm(p, opts);
    const recursive = (opts && opts.recursive) ? '1' : '0';
    await new Promise(function(resolve, reject) {
      const req = http.request(
        { method: 'POST', hostname: '127.0.0.1', port: port,
          path: '/rm?path=' + encodeURIComponent(rpath(s)) + '&recursive=' + recursive,
          headers: { 'x-token': token, 'Content-Length': 0 } },
        function(res) { res.resume(); res.on('end', function() { res.statusCode < 300 ? resolve() : reject(new Error('HTTP ' + res.statusCode)); }); }
      );
      req.on('error', reject); req.end();
    });
  };

  fs.promises.copyFile = async function patchedCopyFile(src, dest) {
    const srcS  = abs(src);
    const destS = abs(dest);
    if (!srcS || !isFakePath(srcS, fakeRoot)) return origP.copyFile(src, dest);
    await new Promise(function(resolve, reject) {
      const req = http.request(
        { method: 'POST', hostname: '127.0.0.1', port: port,
          path: '/copy?from=' + encodeURIComponent(rpath(srcS)) + '&to=' + encodeURIComponent(destS ? rpath(destS) : String(dest)),
          headers: { 'x-token': token, 'Content-Length': 0 } },
        function(res) { res.resume(); res.on('end', function() { res.statusCode < 300 ? resolve() : reject(new Error('HTTP ' + res.statusCode)); }); }
      );
      req.on('error', reject); req.end();
    });
  };

  // fs.promises.open: return a minimal FileHandle for reading
  fs.promises.open = async function patchedOpen(p, flags, mode) {
    const s = typeof p === 'string' ? abs(p) : null;
    if (!s || !isFakePath(s, fakeRoot)) return origP.open(p, flags, mode);
    // Fetch the file content eagerly; return a minimal FileHandle-like object
    const content = await httpGetAsync(port, token, '/read?path=' + encodeURIComponent(rpath(s)));
    const buf = Buffer.from(content, 'utf8');
    let pos = 0;
    return {
      readFile: async function(opts) {
        const enc = typeof opts === 'string' ? opts : (opts && opts.encoding);
        return enc ? content : buf;
      },
      read: async function(buffer, offset, length, position) {
        const start = position != null ? position : pos;
        const copied = buf.copy(buffer, offset, start, start + length);
        pos = start + copied;
        return { bytesRead: copied, buffer };
      },
      close: async function() {},
      [Symbol.asyncDispose]: async function() {},
    };
  };

  // watch / watchFile: inotify can't cross machines, so we poll the remote
  // /stat endpoint and emit 'change' when mtimeMs shifts.
  const origWatch     = fs.watch.bind(fs);
  const origWatchFile = fs.watchFile ? fs.watchFile.bind(fs) : null;
  const origUnwatchFile = fs.unwatchFile ? fs.unwatchFile.bind(fs) : null;

  // Registry for watchFile pollers keyed by resolved path, so unwatchFile can stop them.
  const watchFilePollers = new Map();

  fs.watch = function patchedWatch(filename, opts, listener) {
    const s = abs(typeof filename === 'string' ? filename : null);
    if (!s || !isFakePath(s, fakeRoot)) return origWatch(filename, opts, listener);

    if (typeof opts === 'function') { listener = opts; opts = {}; }

    const { EventEmitter } = require('events');
    const watcher = new EventEmitter();
    if (listener) watcher.on('change', listener);

    // file mtimes: '' → file itself, or filename → entry inside directory
    var mtimes = new Map();
    var isDir = null;
    var closed = false;

    function pollFile() {
      return httpGetAsync(port, token, '/stat?path=' + encodeURIComponent(rpath(s)))
        .then(function(body) {
          var info = JSON.parse(body);
          var prev = mtimes.get('');
          if (prev !== undefined && info.mtimeMs !== prev) {
            watcher.emit('change', 'change', path.basename(s));
          }
          mtimes.set('', info.mtimeMs);
        });
    }

    function pollDir() {
      // Single request returns all entries with their mtimes
      return httpGetAsync(port, token, '/liststat?path=' + encodeURIComponent(rpath(s)))
        .then(function(body) {
          var entries = JSON.parse(body);
          entries.forEach(function(e) {
            if (!e.isFile) return;
            var prev = mtimes.get(e.name);
            if (prev !== undefined && e.mtimeMs !== prev) {
              watcher.emit('change', 'change', e.name);
            }
            mtimes.set(e.name, e.mtimeMs);
          });
        });
    }

    function poll() {
      if (closed) return;
      var work;
      if (isDir === null) {
        work = httpGetAsync(port, token, '/stat?path=' + encodeURIComponent(rpath(s)))
          .then(function(body) {
            isDir = JSON.parse(body).isDirectory;
            return isDir ? pollDir() : pollFile();
          });
      } else {
        work = isDir ? pollDir() : pollFile();
      }
      work.catch(function() {}).then(function() { if (!closed) setTimeout(poll, 1000); });
    }
    poll();

    watcher.close = function() { closed = true; };
    watcher.ref   = function() { return watcher; };
    watcher.unref = function() { return watcher; };
    return watcher;
  };

  fs.watchFile = function patchedWatchFile(filename, opts, listener) {
    const s = abs(typeof filename === 'string' ? filename : null);
    if (!s || !isFakePath(s, fakeRoot)) {
      return origWatchFile ? origWatchFile(filename, opts, listener) : undefined;
    }
    if (typeof opts === 'function') { listener = opts; opts = {}; }
    const interval = (opts && opts.interval) || 5007;

    var lastStat = null;
    var closed = false;

    function poll() {
      if (closed) return;
      httpGetAsync(port, token, '/stat?path=' + encodeURIComponent(rpath(s)))
        .then(function(body) {
          var info = JSON.parse(body);
          var cur = makeStats(info);
          if (lastStat !== null && cur.mtimeMs !== lastStat.mtimeMs) {
            if (listener) listener(cur, lastStat);
          }
          lastStat = cur;
        })
        .catch(function() {})
        .then(function() { if (!closed) setTimeout(poll, interval); });
    }
    poll();

    watchFilePollers.set(s, function stop() { closed = true; });
  };

  fs.unwatchFile = function patchedUnwatchFile(filename, listener) {
    const s = abs(typeof filename === 'string' ? filename : null);
    if (!s || !isFakePath(s, fakeRoot)) {
      return origUnwatchFile ? origUnwatchFile(filename, listener) : undefined;
    }
    const stop = watchFilePollers.get(s);
    if (stop) { stop(); watchFilePollers.delete(s); }
  };

  // Mirror all async patches onto the standalone 'fs/promises' module object too.
  // ES modules that do `import { readFile } from 'node:fs/promises'` get static
  // bindings from this object — patching it ensures they see our interceptors.
  fsp.access     = fs.promises.access;
  fsp.readFile   = fs.promises.readFile;
  fsp.readdir    = fs.promises.readdir;
  fsp.stat       = fs.promises.stat;
  fsp.lstat      = fs.promises.lstat;
  fsp.writeFile  = fs.promises.writeFile;
  fsp.appendFile = fs.promises.appendFile;
  fsp.mkdir      = fs.promises.mkdir;
  fsp.rm         = fs.promises.rm;
  fsp.unlink     = fs.promises.unlink;
  fsp.copyFile   = fs.promises.copyFile;
  fsp.open       = fs.promises.open;
}

module.exports = { patchFs };
