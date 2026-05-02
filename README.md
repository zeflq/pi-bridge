# pi-bridge

Transparent filesystem bridge that makes [pi](https://github.com/badlogic/pi-mono) run natively on a remote machine — no internet required on the remote, no tools to install beyond Node.js.

Pi runs on your local machine (needs internet for auth and Claude API). Your project lives on a remote Linux machine. `pi-bridge` intercepts all of pi's filesystem calls and redirects them over SSH to a tiny HTTP server running on the remote. Pi thinks it's running locally — it finds `AGENTS.md`, skills, context files, and git state natively, without knowing they're remote.

## Prerequisites

- Node.js on the **local** machine (already required by pi)
- Node.js on the **remote** machine
- SSH access to the remote machine with key-based auth (no password prompt)
- `pi` installed locally

## Installation

```bash
git clone https://github.com/zeflq/pi-bridge ~/.pi-bridge
cd ~/.pi-bridge
npm install
```

## Setup

### macOS / Linux

Add to your shell profile (`~/.zshrc` or `~/.bashrc`):

```bash
alias pii='node --require ~/.pi-bridge/src/local/preload.js $(which pi)'
```

Reload your shell:

```bash
source ~/.zshrc   # or ~/.bashrc
```

### Windows (PowerShell)

Add to your PowerShell profile (`$PROFILE`):

```powershell
function pii {
    # Get-Command returns the .ps1 wrapper — resolve the actual .js entry point
    $piJs = [System.IO.Path]::ChangeExtension((Get-Command pi -ErrorAction Stop).Source, '.js')
    node --require "$HOME\.pi-bridge\src\local\preload.js" $piJs @args
}
```

Reload your profile:

```powershell
. $PROFILE
```

### Windows (CMD / batch)

Create a `pii.cmd` file somewhere on your `PATH`:

```bat
@echo off
for /f "delims=" %%i in ('where pi') do set PI_PATH=%%i
node --require "%USERPROFILE%\.pi-bridge\src\local\preload.js" "%PI_PATH%" %*
```

## Usage

Use `pii` exactly like `pi`, adding `--ssh` to point at your remote project:

```bash
# Absolute path
pii --ssh user@host:/root/projects/my-app

# With SSH alias (configured in ~/.ssh/config)
pii --ssh myserver:/root/projects/my-app

# Tilde path (expanded by remote shell)
pii --ssh user@host:~/projects/my-app
```

Everything works natively — pi discovers `AGENTS.md`, skills, and context files on the remote without any extra flags or extensions.

## How It Works

```
Local machine                          Remote (Linux)
─────────────────────────────          ──────────────────────
preload.js (--require)
  ├─ upload server bundle via SSH
  ├─ start HTTP server on remote
  │    → prints PORT:TOKEN to stdout
  ├─ SSH port forward localhost:PORT
  ├─ create fake local dir:
  │    /tmp/pi-bridge/root/projects/my-app
  ├─ process.chdir(fakeLocalCwd)
  ├─ strip --ssh from process.argv
  ├─ patch fs.*  (sync + promises)     remote/index.js
  └─ patch child_process.*               listens on 127.0.0.1:PORT
                                         validates token
pi loads — unaware of bridge            restricts to remoteCwd
  fs.readFileSync(...)  ──GET──→        reads real remote files
  fs.readdirSync(...)   ──GET──→        ← returns data
  spawn('git', ...)     ──SSH──→        runs on remote
  → finds AGENTS.md ✓
  → finds skills ✓
  → git branch in footer ✓
```

## What Gets Patched

| API | Covered |
|---|---|
| `fs` sync — read, write, stat, readdir, mkdir, rm, copy, rename, realpath, access, watch | ✓ |
| `fs.promises` — all async equivalents | ✓ |
| `fs/promises` module (ES module static imports) | ✓ |
| `child_process.spawn` / `spawnSync` — runs in remote cwd via SSH | ✓ |
| `fs.watch` / `fs.watchFile` — polls remote via HTTP (git branch updates) | ✓ |

## Security

| Layer | Protection |
|---|---|
| Loopback only | HTTP server binds `127.0.0.1` — not reachable from the network |
| SSH tunnel | All HTTP traffic encrypted end-to-end |
| Random token | 32-byte random token required on every request |
| Path restriction | Server rejects paths outside `remoteCwd` (403) |
| Token in stdout | Token never appears in `ps aux` args |

## Development

Test against a real remote without installing pi:

```bash
SSH_TARGET=user@host:/root/projects/my-app npm run dev
```

Run tests:

```bash
npm test
```

## Troubleshooting

**`Command failed: ssh … syntax error near unexpected token`**
Your SSH alias requires `BatchMode=yes`. Add to `~/.ssh/config`:
```
Host myserver
  BatchMode yes
```

**Files show as empty / ENOENT**
The fake local directory (`/tmp/pi-bridge/…`) is intentionally empty — all reads go to the remote. If you see ENOENT, the bridge may not have started correctly. Check that Node.js is available on the remote (`node --version`).

**Branch name not updating**
The footer polls `.git` every second. Switching branches from outside a pi session is reflected within ~1s. If the branch is stuck, restart `pii`.
