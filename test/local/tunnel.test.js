import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { startTunnel } = require('../../src/local/tunnel.js');

// ── Fake child process ───────────────────────────────────────────────────────

function makeChild() {
  const child = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => { child.killed = true; });
  return child;
}

/**
 * Returns a spawnMock + children array.
 * Each call to spawnMock() pushes a new fake child into children[].
 */
function makeSpawn() {
  const children = [];
  const spawnMock = vi.fn(() => {
    const child = makeChild();
    children.push(child);
    return child;
  });
  return { spawnMock, children };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('startTunnel() watchdog', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('spawns ssh with the correct arguments on start', () => {
    const { spawnMock } = makeSpawn();
    startTunnel('user@host', 12345, { _spawn: spawnMock });

    expect(spawnMock).toHaveBeenCalledOnce();
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe('ssh');
    expect(args).toContain('-N');
    expect(args).toContain('user@host');
    expect(args).toContain('12345:127.0.0.1:12345');
  });

  it('returns an object with a kill() method', () => {
    const { spawnMock } = makeSpawn();
    const handle = startTunnel('user@host', 1234, { _spawn: spawnMock });
    expect(typeof handle.kill).toBe('function');
  });

  it('restarts the tunnel when the process exits', () => {
    const { spawnMock, children } = makeSpawn();
    startTunnel('user@host', 1234, { _spawn: spawnMock });

    expect(spawnMock).toHaveBeenCalledTimes(1);

    children[0].emit('exit', 1);
    vi.advanceTimersByTime(1100);

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it('back-off doubles on repeated failures', () => {
    const { spawnMock, children } = makeSpawn();
    startTunnel('user@host', 1234, { _spawn: spawnMock });

    // 1st restart — back-off is 1000ms
    children[0].emit('exit', 1);
    vi.advanceTimersByTime(1100);
    expect(spawnMock).toHaveBeenCalledTimes(2);

    // 2nd restart — back-off doubled to 2000ms
    children[1].emit('exit', 1);
    vi.advanceTimersByTime(1100); // not enough yet
    expect(spawnMock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000); // now past 2000ms total
    expect(spawnMock).toHaveBeenCalledTimes(3);
  });

  it('kill() stops the current child process', () => {
    const { spawnMock, children } = makeSpawn();
    const handle = startTunnel('user@host', 1234, { _spawn: spawnMock });

    handle.kill();

    expect(children[0].kill).toHaveBeenCalled();
  });

  it('kill() prevents restart after the process exits', () => {
    const { spawnMock, children } = makeSpawn();
    const handle = startTunnel('user@host', 1234, { _spawn: spawnMock });

    handle.kill();
    children[0].emit('exit', 0);
    vi.advanceTimersByTime(5000);

    expect(spawnMock).toHaveBeenCalledTimes(1);
  });

  it('back-off resets to 1s after tunnel is stable for 5s', () => {
    const { spawnMock, children } = makeSpawn();
    startTunnel('user@host', 1234, { _spawn: spawnMock });

    // Let the tunnel run for 5s → back-off resets to 1000ms
    vi.advanceTimersByTime(5100);

    children[0].emit('exit', 1);
    vi.advanceTimersByTime(1100);

    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
});
