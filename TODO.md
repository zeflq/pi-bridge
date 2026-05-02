# pi-bridge — TODO

## Project structure
- [ ] `package.json` with `vitest` as dev dependency, `"test": "vitest --run"` and `"dev": "node dev.js"` scripts
- [ ] `dev.js` — reads `SSH_TARGET` env var, runs preload + dummy app
- [ ] `test/integration/app.js` — dummy app (logs cwd, lists dir, reads AGENTS.md)
- [ ] `README.md`

## Shared

### `src/shared/protocol.js` — single source of truth
- [ ] Endpoint paths: `/list`, `/read`, `/exists`, `/write`, `/mkdir`, `/delete`, `/rename`
- [ ] Token header name: `x-token`
- [ ] Response shapes: list → JSON array, exists → `1`/`0`
- [ ] Error codes: 401 unauthorized, 403 forbidden, 404 not found

## Remote (runs on remote machine)

### `src/remote/index.js` — entry point
- [ ] Start HTTP server on `127.0.0.1`, random port
- [ ] Wire auth + guard middleware
- [ ] Route requests to handlers
- [ ] Print `PORT:TOKEN` to stdout

### `src/remote/auth.js` — token validation
- [ ] Generate random token via `crypto.randomBytes`
- [ ] Expose token to server
- [ ] Reject requests with missing/wrong `x-token` → 401

### `src/remote/guard.js` — path restriction
- [ ] Resolve requested path with `path.resolve`
- [ ] Reject paths outside `remoteCwd` → 403

### `src/remote/handlers.js` — file operations
- [ ] `GET /list?path=` → `fs.readdirSync` → JSON
- [ ] `GET /read?path=` → `fs.readFileSync` → text
- [ ] `GET /exists?path=` → `fs.existsSync` → `1`/`0`
- [ ] `POST /write?path=` → `fs.writeFileSync`
- [ ] `POST /mkdir?path=` → `fs.mkdirSync` recursive
- [ ] `POST /delete?path=` → `fs.unlinkSync`
- [ ] `POST /rename?from=&to=` → `fs.renameSync`

## Local (runs on local machine)

### `src/local/preload.js` — entry point
- [ ] Call `argv.js` to parse `--ssh` flag
- [ ] Call `setup.js` via `spawnSync`, parse JSON result
- [ ] Call `fake-dir.js` to create fake local dir
- [ ] `process.chdir(fakeLocalCwd)`
- [ ] Call `fs-patch.js` to patch fs
- [ ] Register `cleanup.js` on `process.exit`

### `src/local/argv.js` — argument parsing
- [ ] Parse `--ssh user@host:/path` from `process.argv`
- [ ] Strip `--ssh` and its value from `process.argv`
- [ ] Return `{ remote, rawPath }`

### `src/local/setup.js` — orchestrator
- [ ] Call `upload.js` to upload remote server
- [ ] Start remote server, capture `PORT:TOKEN` from stdout
- [ ] Call `tunnel.js` to set up port forwarding
- [ ] Print result as JSON: `{ port, token, remoteCwd }`

### `src/local/ssh.js` — SSH execution primitive
- [ ] Execute a command on remote via `execFile('ssh', [remote, cmd])`
- [ ] Return stdout as string, reject on non-zero exit

### `src/local/upload.js` — bundle + upload remote server
- [ ] Read `src/remote/index.js` locally
- [ ] Read `src/shared/protocol.js` and inline constants into the bundle
- [ ] Base64-encode bundle and upload to `/tmp/pi-bridge-server.js` via SSH

### `src/local/tunnel.js` — SSH port forwarding
- [ ] Spawn `ssh -L PORT:localhost:PORT user@host -N`
- [ ] Return child process reference for cleanup

### `src/local/path-mapper.js` — path conversion (pure, no I/O)
- [ ] `toFakePath(remotePath, fakeRoot)` → local path (OS-aware separators)
- [ ] `toRemotePath(fakePath, fakeRoot)` → remote POSIX path
- [ ] `isFakePath(p, fakeRoot)` → boolean

### `src/local/http-client.js` — HTTP requests
- [ ] Send GET/POST to `http://localhost:PORT/<endpoint>`
- [ ] Attach `x-token` header on every request
- [ ] Return response body as string

### `src/local/fs-patch.js` — fs interception
- [ ] Patch `readdirSync`, `readFileSync`, `existsSync`
- [ ] Patch `writeFileSync`, `mkdirSync`, `unlinkSync`, `renameSync`
- [ ] Fake-root paths → delegate to `http-client.js`
- [ ] Other paths → call original fs function

### `src/local/fake-dir.js` — fake directory management
- [ ] Create empty dir skeleton: `os.tmpdir()/pi-bridge/<remotePath>`
- [ ] Return `fakeRoot` and `fakeLocalCwd`

### `src/local/cleanup.js` — session teardown
- [ ] Remove fake local dir
- [ ] Kill SSH tunnel process
- [ ] Delete remote server file via SSH

## Tests

### `test/remote/auth.test.js`
- [ ] Valid token → passes
- [ ] Missing token → 401
- [ ] Wrong token → 401

### `test/remote/guard.test.js`
- [ ] Path inside remoteCwd → passes
- [ ] Path outside remoteCwd → 403
- [ ] Path traversal (`../`) → 403

### `test/remote/handlers.test.js`
- [ ] list, read, exists, write, mkdir, delete, rename

### `test/local/argv.test.js`
- [ ] Parses `--ssh user@host:/path`
- [ ] Parses `--ssh user@host:~/path`
- [ ] Strips `--ssh` and value from argv

### `test/local/path-mapper.test.js`
- [ ] `toRemotePath` on Windows fake path
- [ ] `toRemotePath` on Linux fake path
- [ ] `isFakePath` true/false cases

### `test/local/fs-patch.test.js`
- [ ] Fake-root path intercepted → HTTP call made
- [ ] Non-fake path passes through to original fs

### `test/local/http-client.test.js`
- [ ] Token header attached on every request
- [ ] GET and POST requests formatted correctly

### `test/local/upload.test.js`
- [ ] Bundled output contains inlined protocol constants
- [ ] Bundled output has no `require('./shared/protocol')`

### `test/shared/protocol.test.js`
- [ ] All endpoint paths defined
- [ ] Token header name defined
- [ ] Error codes defined
