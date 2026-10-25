import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { missingHint, pipeLink, refuseHello } from './host-link.js';
import type { HostToMain } from './host-protocol.js';
import {
  decodeFrame,
  encodeFrame,
  encodeHello,
  FRAME,
  HOST_PROTOCOL,
  type HostHello,
} from './host-wire.js';

vi.mock('electron', () => ({}));

const HELLO: HostHello = {
  protocol: HOST_PROTOCOL,
  version: '1.0.0',
  platform: 'linux',
  home: '/home/me',
  distro: 'Ubuntu',
};

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  const written: unknown[] = [];
  child.stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.startsWith(FRAME))
        written.push(decodeFrame(line.slice(FRAME.length)));
    }
  });
  return { child, written };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function link() {
  const { child, written } = fakeChild();
  const onHello = vi.fn();
  const host = pipeLink({
    target: { kind: 'wsl', distro: 'Ubuntu' },
    child: child as unknown as ChildProcess,
    frontendVersion: '1.0.0',
    onHello,
  });
  const messages: HostToMain[] = [];
  host.onMessage((m) => messages.push(m));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  return { child, written, host, messages, onHello };
}

describe('pipeLink', () => {
  it('holds what main sends until the host says hello, past the shell’s noise', async () => {
    const { child, written, host, messages, onHello } = link();
    host.post({ t: 'theme', theme: 'dark' });
    await tick();
    expect(written).toEqual([]);
    child.stdout.write('Last login: Mon\n');
    child.stdout.write(encodeHello(HELLO));
    await tick();
    expect(onHello).toHaveBeenCalledWith(HELLO);
    expect(written).toEqual([{ t: 'theme', theme: 'dark' }]);
    child.stdout.write(encodeFrame({ t: 'ready', repo: '/home/me/repo' }));
    await tick();
    expect(messages).toEqual([{ t: 'ready', repo: '/home/me/repo' }]);
  });

  it('obeys no frame from before the hello', async () => {
    const { child, messages } = link();
    child.stdout.write(encodeFrame({ t: 'ready', repo: null }));
    await tick();
    expect(messages).toEqual([]);
  });

  it('refuses a host speaking another protocol, saying which version to install', async () => {
    const { child, messages } = link();
    child.stdout.write(
      encodeHello({ ...HELLO, protocol: HOST_PROTOCOL + 1, version: '2.0.0' })
    );
    await tick();
    expect(messages).toHaveLength(1);
    const [fatal] = messages;
    expect(fatal?.t).toBe('fatal');
    expect(fatal && 'message' in fatal && fatal.message).toMatch(
      /WSL \(Ubuntu\).*2\.0\.0.*@notaharness\/n10@1\.0\.0/s
    );
    expect(child.kill).toHaveBeenCalled();
  });

  it('explains a host that ended before its hello by its last words', async () => {
    const { child, messages } = link();
    child.stderr.write('sh: 1: exec: n10: not found\n');
    await tick();
    child.emit('exit', 127);
    expect(messages).toHaveLength(1);
    const [fatal] = messages;
    expect(fatal && 'message' in fatal && fatal.message).toMatch(
      /n10 is not installed there/
    );
  });

  it('reports exits to every listener, as a code', () => {
    const { child, host } = link();
    const exits: number[] = [];
    host.onceExit((code) => exits.push(code));
    host.onceExit((code) => exits.push(code));
    child.emit('exit', null);
    expect(exits).toEqual([1, 1]);
  });
});

describe('refuseHello', () => {
  it('accepts its own protocol on Linux or macOS', () => {
    expect(refuseHello(HELLO, '1.0.0')).toBeNull();
    expect(refuseHello({ ...HELLO, platform: 'darwin' }, '1.0.0')).toBeNull();
  });

  it('refuses a Windows n10 that WSL’s PATH found through interop', () => {
    expect(refuseHello({ ...HELLO, platform: 'win32' }, '1.0.0')).toMatch(
      /Windows install/
    );
  });
});

describe('missingHint', () => {
  it('passes other errors through', () => {
    expect(missingHint('tmux: not found')).toBe('tmux: not found');
    expect(missingHint('')).toMatch(/without saying why/);
  });
});
