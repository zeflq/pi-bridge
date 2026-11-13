import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);
const { findPi, cliFromPackage, looksLikeNodeScript } = require('../../src/local/find-pi.js');

const SH_SHIM = '#!/bin/sh\nbasedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")\n';

let tmp;

function write(rel, content) {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

function writePiPackage(nodeModules, scope, bin, entry) {
  const pkgDir = path.join(nodeModules, scope, 'pi-coding-agent');
  write(path.relative(tmp, path.join(pkgDir, 'package.json')), JSON.stringify({ name: `${scope}/pi-coding-agent`, bin }));
  return write(path.relative(tmp, path.join(pkgDir, entry)), '#!/usr/bin/env node\n');
}

beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'find-pi-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('cliFromPackage', () => {
  it('follows bin.pi (pi >= 1.5: dist/bundle/cli.js)', () => {
    const cli = writePiPackage(path.join(tmp, 'nm'), '@earendil-works', { pi: 'dist/bundle/cli.js' }, 'dist/bundle/cli.js');
    expect(cliFromPackage(path.join(tmp, 'nm', '@earendil-works', 'pi-coding-agent'))).toBe(cli);
  });

  it('accepts a string bin field', () => {
    const cli = writePiPackage(path.join(tmp, 'nm'), '@earendil-works', 'dist/cli.js', 'dist/cli.js');
    expect(cliFromPackage(path.join(tmp, 'nm', '@earendil-works', 'pi-coding-agent'))).toBe(cli);
  });

  it('returns null when the package is missing', () => {
    expect(cliFromPackage(path.join(tmp, 'nope'))).toBe(null);
  });
});

describe('looksLikeNodeScript', () => {
  it('rejects npm sh shims and accepts node scripts', () => {
    expect(looksLikeNodeScript(write('shim', SH_SHIM))).toBe(false);
    expect(looksLikeNodeScript(write('a', '#!/usr/bin/env node\n'))).toBe(true);
    expect(looksLikeNodeScript(write('b', 'console.log(1)\n'))).toBe(true);
  });
});

describe('findPi', () => {
  it('finds pi in the shared node_modules beside pi-bridge', () => {
    const nm = path.join(tmp, 'lib', 'node_modules');
    const cli = writePiPackage(nm, '@earendil-works', { pi: 'dist/bundle/cli.js' }, 'dist/bundle/cli.js');
    const res = findPi({ bridgeBinDir: path.join(nm, 'pi-bridge', 'bin'), locate: () => [], execPath: 'NODE' });
    expect(res).toEqual({ cli, nodeExe: 'NODE' });
  });

  it('falls back to the legacy @mariozechner scope', () => {
    const nm = path.join(tmp, 'lib', 'node_modules');
    const cli = writePiPackage(nm, '@mariozechner', { pi: 'dist/cli.js' }, 'dist/cli.js');
    const res = findPi({ bridgeBinDir: path.join(nm, 'pi-bridge', 'bin'), locate: () => [], execPath: 'NODE' });
    expect(res.cli).toBe(cli);
  });

  it('Windows linked checkout: resolves node_modules beside the PATH launcher, not the sh shim', () => {
    // npm global prefix on Windows: <prefix>/pi, <prefix>/pi.cmd, <prefix>/node_modules/...
    const prefix = path.join(tmp, 'npm');
    const shim = write('npm/pi', SH_SHIM);
    write('npm/pi.cmd', '@ECHO off\n');
    const cli = writePiPackage(path.join(prefix, 'node_modules'), '@earendil-works', { pi: 'dist/bundle/cli.js' }, 'dist/bundle/cli.js');

    const res = findPi({
      bridgeBinDir: path.join(tmp, 'checkout', 'bin'), // linked checkout: no shared node_modules
      locate: () => [shim, path.join(prefix, 'pi.cmd')],
      platform: 'win32',
      execPath: 'NODE',
    });
    expect(res).toEqual({ cli, nodeExe: 'NODE' });
  });

  it('POSIX npm prefix: resolves <prefix>/lib/node_modules from <prefix>/bin/pi', () => {
    const shim = write('prefix/bin/pi', SH_SHIM);
    const cli = writePiPackage(path.join(tmp, 'prefix', 'lib', 'node_modules'), '@earendil-works', { pi: 'dist/bundle/cli.js' }, 'dist/bundle/cli.js');
    const res = findPi({ bridgeBinDir: path.join(tmp, 'checkout', 'bin'), locate: () => [shim], platform: 'linux', execPath: 'NODE' });
    expect(res.cli).toBe(cli);
  });

  it('never returns an sh shim as the CLI', () => {
    const shim = write('bin/pi', SH_SHIM);
    const res = findPi({ bridgeBinDir: path.join(tmp, 'checkout', 'bin'), locate: () => [shim], platform: 'win32', execPath: 'NODE' });
    expect(res).toBe(null);
  });

  it('pi.dev installer: follows the bin/pi symlink and prefers the bundled node', () => {
    const cli = write('pi-install/lib/dist/bundle/cli.js', '#!/usr/bin/env node\n');
    const node = write('pi-install/bin/node', '');
    const link = path.join(tmp, 'pi-install', 'bin', 'pi');
    fs.symlinkSync(cli, link);
    const res = findPi({ bridgeBinDir: path.join(tmp, 'checkout', 'bin'), locate: () => [link], platform: 'linux', execPath: 'NODE' });
    expect(res).toEqual({ cli: fs.realpathSync(cli), nodeExe: node });
  });
});
