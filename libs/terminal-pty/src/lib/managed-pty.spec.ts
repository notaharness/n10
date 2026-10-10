import { afterEach, describe, expect, it } from 'vitest';
import type { ManagedTarget, SessionBackend, SessionSpec } from '@n10/terminal';
import { ManagedPty, REPLAY_BYTES } from './managed-pty.js';

/** The handle contract over real processes in real PTYs: releasing a
 *  handle leaves the session running, a new one replays what it
 *  missed, and only a stop ends it. */

const TARGET: ManagedTarget = {
  kind: 'mux',
  hostId: 'host',
  sessionId: 'session',
  name: 'label',
};

function spec(script: string): SessionSpec {
  return {
    cmd: '/bin/sh',
    args: ['-c', script],
    cwd: process.cwd(),
    cols: 80,
    rows: 24,
  };
}

function recorded(handle: SessionBackend) {
  let text = '';
  const exits: [number, number | undefined][] = [];
  handle.onData((data) => (text += data));
  handle.onExit((code, signal) => exits.push([code, signal]));
  return { text: () => text, exits };
}

async function until(check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 200));

let session: ManagedPty;
afterEach(() => session.stop());

describe.skipIf(process.platform === 'win32')('a managed PTY', () => {
  it('keeps running when its handle is released, and replays it to the next first', async () => {
    session = new ManagedPty(
      TARGET,
      spec('echo first; read line; echo "then $line"; exec sleep 30')
    );
    const first = recorded(session.attach());
    await until(() => first.text().includes('first'));
    const pid = session.pid;
    session.attach().dispose();
    const second = session.attach();
    // Released: neither handle stopped the process.
    expect([session.running, session.pid]).toEqual([true, pid]);
    const order: string[] = [];
    second.onData((data) => order.push(data));
    second.write('live\r');
    await until(() => order.join('').includes('then live'));
    expect(order[0]).toContain('first');
    expect(order[0]).not.toContain('then live');
  });

  it('stops from any handle, and every handle hears the process’s own exit once', async () => {
    session = new ManagedPty(
      TARGET,
      spec("trap 'exit 42' HUP; echo armed; while :; do sleep 1; done")
    );
    const a = recorded(session.attach());
    const b = recorded(session.attach());
    await until(() => a.text().includes('armed'));
    const stopping = session.attach();
    stopping.kill();
    expect(session.gone).toBe(true);
    await until(() => a.exits.length > 0 && b.exits.length > 0);
    await settle();
    expect(a.exits).toEqual([[42, undefined]]);
    expect(b.exits).toEqual([[42, undefined]]);
    expect(session.exit).toEqual({ exitCode: 42 });
    expect(() => session.attach()).toThrow('stopped');
  });

  it('retains no more output than its bound', async () => {
    session = new ManagedPty(
      TARGET,
      spec(
        `head -c ${
          REPLAY_BYTES * 3
        } /dev/zero | tr '\\0' 'é'; echo; echo tail-end; exec sleep 30`
      )
    );
    const watcher = recorded(session.attach());
    await until(() => watcher.text().includes('tail-end'), 20_000);
    expect(session.retainedBytes).toBeLessThanOrEqual(REPLAY_BYTES);
    const replay = recorded(session.attach());
    await until(() => replay.text().includes('tail-end'));
    expect(Buffer.byteLength(replay.text())).toBeLessThanOrEqual(REPLAY_BYTES);
  });

  it('replaces its process as the next generation without reporting an exit', async () => {
    session = new ManagedPty(TARGET, spec('echo one; exec sleep 30'));
    const handle = recorded(session.attach());
    await until(() => handle.text().includes('one'));
    session.replace(spec('echo two; exec sleep 30'));
    await until(() => handle.text().includes('two'));
    await settle();
    expect(session.generation).toBe(2);
    expect(handle.exits).toEqual([]);
    expect(session.running).toBe(true);
  });
});
