# pi-bridge

Transparent filesystem bridge that makes pi run natively on a remote machine — no internet required on remote, no tools to install on the local machine. Works on Windows and Linux/Mac.

## Problem

Pi runs on the local machine (needs internet for auth and Claude API). The project lives on a remote Linux machine (no internet). Pi's native discovery (AGENTS.md, skills, context files) uses the local `cwd` — it never reaches the remote.

Current workaround (`pi-context` extensions) compensates via `--ssh` flag but pi still doesn't run natively.

## Solution

A preload layer that intercepts all of pi's filesystem calls and transparently redirects them to a tiny HTTP file server running on the remote. Pi thinks it's running locally — it finds AGENTS.md, skills, and context files natively without knowing they're remote.

## Architecture

```
Local machine (pi)                     Remote (Linux)
────────────────────────────────       ──────────────────────
preload.js
  │
  ├─ upload remote/index.js via SSH
  ├─ start: node /tmp/pi-bridge.js /root/project
  │         → prints PORT:TOKEN to stdout
  ├─ SSH port forward: localhost:PORT → remote:PORT
  ├─ create fake local dir:
  │    os.tmpdir()/pi-bridge/root/project  (OS-aware path)
  ├─ process.chdir(fakeLocalCwd)
  ├─ strip --ssh from process.argv
  └─ patch fs.*:
       readdirSync(fakeLocalPath)
         → strip fake root
         → GET localhost:PORT/list?path=/root/project
         → x-token: <token>
         → return result

pi.js loads (unaware of bridge)        remote/index.js
  ctx.cwd = os.tmpdir()/pi-bridge/...    listens on 127.0.0.1:PORT
  fs.readdirSync(...)   ──GET──→         validates token
  fs.readFileSync(...)  ──GET──→         restricts to /root/project (argv[2])
  fs.writeFileSync(...) ──POST──→        reads/writes real remote files
  → finds AGENTS.md ✓                    ← returns data
  → finds skills ✓
  → writes reflected on remote ✓
  → context-files works ✓
```

## Path Mapping

```
Remote path:       /root/project-x/.pi/AGENTS.md
Fake local path:   {os.tmpdir()}/pi-bridge/root/project-x/.pi/AGENTS.md

fakeRoot    =  path.join(os.tmpdir(), 'pi-bridge')
remotePath  =  fakePath.slice(fakeRoot.length).split(path.sep).join('/')
```

`path.sep` handles OS differences automatically — `\` on Windows, `/` on Linux/Mac.

## Security Model

| Layer | Protection |
|---|---|
| Loopback only | File server not reachable from network on either side |
| SSH tunnel | All HTTP traffic encrypted end-to-end over the network |
| Random token | Other local Windows processes can't call the API |
| Path restriction | Can't read files outside `remoteCwd` on remote |
| Token in stdout | Token never appears in `ps aux` command args |

## Usage

**Linux/Mac (shell profile):**
```bash
# Use $(which pi) — pi may be installed as a direct bin, not inside an npm package
alias pi='node --require ~/projects/pi-bridge/src/local/preload.js $(which pi)'
```

```bash
# Use exactly like before — bridge is invisible
pi --ssh user@host:/root/project-x
```

**Windows (PowerShell profile):**
```powershell
function pi {
  $piPath = (Get-Command pi).Source
  node --require "C:\...\pi-bridge\src\local\preload.js" $piPath @args
}
```

## What This Replaces

With `pi-bridge`, pi runs natively on the remote project:
- `ssh-context` extension → no longer needed
- `ssh-skills` extension → no longer needed
- `context-files` extension → works natively (no SSH mode needed)

## File Structure

```
pi-bridge/
  src/
    remote/                   # Everything that runs on the remote machine
      index.js                # Entry point — starts the HTTP server
      auth.js                 # Token validation middleware
      guard.js                # Path restriction (scope to remoteCwd)
      handlers.js             # File operation handlers (list/read/write/…)

    shared/                   # Single source of truth for protocol constants
      protocol.js             # Endpoint names, header name, response shapes, error codes

    local/                    # Everything that runs on the local machine
      preload.js              # Entry point — thin orchestrator (--require target)
      argv.js                 # Parse + strip --ssh from process.argv
      setup.js                # Orchestrator: upload → start → tunnel → return config
      ssh.js                  # SSH command execution primitive
      upload.js               # Bundle remote/index.js + shared/protocol.js → upload via SSH
      tunnel.js               # SSH port forwarding (-L)
      path-mapper.js          # Fake local path ↔ remote path conversion
      http-client.js          # HTTP requests to file server (attaches token)
      fs-patch.js             # Patch Node.js fs.* to intercept fake-root paths
      fake-dir.js             # Create / remove fake local directory skeleton
      cleanup.js              # Session teardown (fake dir, tunnel, remote server)

  test/
    remote/
      auth.test.js            # Token validation
      guard.test.js           # Path restriction
      handlers.test.js        # File operation endpoints
    local/
      argv.test.js            # --ssh parsing and stripping
      path-mapper.test.js     # Fake ↔ remote path mapping (Windows + Linux)
      fs-patch.test.js        # fs.* interception + passthrough
      http-client.test.js     # Request formatting + token header
      upload.test.js          # Bundling inlines shared/protocol.js correctly
    shared/
      protocol.test.js        # Constants are consistent and complete
    integration/
      app.js                  # Dummy app: logs cwd, lists dir, reads AGENTS.md

  dev.js                      # Dev entrypoint: reads SSH_TARGET env var, runs preload + app.js
  package.json
  README.md
  PLAN.md
  TODO.md
```

**Layer responsibilities:**

| Layer | Files | Rule |
|---|---|---|
| Entry points | `remote/index.js`, `local/preload.js` | Orchestrate only, no logic |
| Use cases | `setup.js`, `fs-patch.js`, `fake-dir.js` | Single operation each |
| Adapters | `ssh.js`, `http-client.js`, `tunnel.js`, `upload.js` | I/O boundary only |
| Core | `path-mapper.js`, `auth.js`, `guard.js`, `argv.js` | Pure logic, no I/O |

## Prerequisites

- Windows 10/11, Linux, or Mac (built-in `ssh` client)
- Node.js on local machine (already required by pi)
- Node.js on remote (for `remote/index.js`)
- SSH access to remote machine

## Tasks

See [TODO.md](TODO.md)
