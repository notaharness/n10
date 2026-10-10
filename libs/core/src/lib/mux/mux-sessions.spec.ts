import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeSessionBackend, ownSessions } from '../session-backend.js';
import { selectLocalCatalog } from '../session-catalog.js';
import { tmuxCatalog } from '../tmux-catalog.js';
import { muxRequest } from './mux-client.js';
import { muxRuntime } from './mux-endpoint.js';
import { connectMux } from './mux-ipc.js';
import { FrameReader, type MuxSummary } from './mux-protocol.js';

/**
 * The one-shot verbs against a real owner, over its real endpoint in a
 * scratch HOME, with real processes in its sessions.
 */

let home: string;
let hostId: string;
const savedHome = process.env['HOME'];
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'n10-mux-'));
  process.env['HOME'] = home;
  const owner = await ownSessions('headless');
  hostId = owner.hostId;
});
afterEach(() => {
  closeSessionBackend();
  selectLocalCatalog(tmuxCatalog);
  process.env['HOME'] = savedHome;
  rmSync(home, { recursive: true, force: true });
});

const call = async (op: Parameters<typeof muxRequest>[1], params = {}) =>
  (await muxRequest(muxRuntime(), op, params)).result;

const rejected = (op: Parameters<typeof muxRequest>[1], params = {}) =>
  muxRequest(muxRuntime(), op, params).then(
    () => {
      throw new Error(`${op} succeeded`);
    },
    (err: { code: string }) => err.code
  );

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean) {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const create = (params: Record<string, unknown>) =>
  call('session.create', {
    label: 'player',
    cwd: home,
    argv: ['/bin/sh', '-c', 'echo ready; exec sleep 30'],
    ...params,
  }) as Promise<MuxSummary>;

const screen = (sessionId: string) =>
  call('session.capture', { sessionId }) as Promise<{ text: string }>;

/** A program that reports every input it receives as hex, after asking
 *  for bracketed paste and application cursor keys. */
const ECHO_INPUT = [
  process.execPath,
  '-e',
  `process.stdout.write('\\x1b[?2004h\\x1b[?1hready\\n');
   process.stdin.setRawMode(true);
   process.stdin.on('data', (d) => process.stdout.write('<' + d.toString('hex') + '>\\n'));`,
];

describe.skipIf(process.platform === 'win32')('one-shot mux verbs', () => {
  it('reports the owner', async () => {
    expect(await call('host.status')).toEqual({
      protocolVersion: 1,
      hostId,
      ownerType: 'headless',
      os: process.platform,
      sessionCount: 0,
      capabilities: ['oneshot-v1'],
    });
  });

  it('creates a session, lists, inspects and captures it', async () => {
    const created = await create({
      requestId: 'r1',
      tags: { '@orchestra-spawner': 'orchestra' },
    });
    expect(created).toMatchObject({
      hostId,
      generation: 1,
      label: 'player',
      processState: 'running',
      launchKind: 'unknown',
      tags: { '@orchestra-spawner': 'orchestra' },
      requestId: 'r1',
    });
    const { sessionId } = created;
    await until(
      () => screen(sessionId),
      (s) => s.text === 'ready\n'
    );
    const { parts } = await muxRequest(muxRuntime(), 'session.list', {
      capture: 0,
    });
    expect(parts).toMatchObject([
      { sessionId, capture: { text: 'ready\n', truncated: false } },
    ]);
    expect(await call('session.inspect', { sessionId })).toMatchObject({
      sessionId,
    });
  });

  it('refuses what it cannot create, and files nothing', async () => {
    expect(await rejected('session.create', { label: 'a\tb', cwd: home })).toBe(
      'INVALID_REQUEST'
    );
    expect(
      await rejected('session.create', { label: 'p', cwd: join(home, 'gone') })
    ).toBe('INVALID_REQUEST');
    expect(
      await rejected('session.create', {
        label: 'p',
        cwd: home,
        argv: ['no-such-agent-n10'],
      })
    ).toBe('SPAWN_FAILED');
    expect(
      await rejected('session.create', {
        label: 'p',
        cwd: home,
        expectedHostId: 'another',
      })
    ).toBe('IDENTITY_MISMATCH');
    expect(await call('host.status')).toMatchObject({ sessionCount: 0 });
  });

  it('gives a checkout to one session only', async () => {
    const checkout = join(home, 'wt');
    mkdirSync(checkout);
    const tags = { '@orchestra-worktree-path': checkout };
    await create({ tags });
    expect(
      await rejected('session.create', { label: 'b', cwd: home, tags })
    ).toBe('IDENTITY_MISMATCH');
  });

  it('sends paste, literal text and keys as the program asked for them', async () => {
    const { sessionId, generation } = await create({ argv: ECHO_INPUT });
    await until(
      () => screen(sessionId),
      (s) => s.text.includes('ready')
    );
    const send = (params: Record<string, unknown>) =>
      call('session.send', {
        sessionId,
        expectedHostId: hostId,
        generation,
        ...params,
      });
    expect(await send({ mode: 'paste', text: 'hi', submit: true })).toEqual({
      acceptedBytes: 15,
      submitted: true,
    });
    await until(
      () => screen(sessionId),
      (s) =>
        s.text.includes(Buffer.from('\x1b[200~hi\x1b[201~\r').toString('hex'))
    );
    await send({ mode: 'key', key: 'Up' });
    await until(
      () => screen(sessionId),
      (s) => s.text.includes(`<${Buffer.from('\x1bOA').toString('hex')}>`)
    );
    expect(
      await rejected('session.send', {
        sessionId,
        expectedHostId: hostId,
        generation: generation + 1,
        mode: 'literal',
        text: 'x',
      })
    ).toBe('STALE_GENERATION');
  });

  it('restarts only an exited session, as its next generation', async () => {
    const running = await create({ retainOnExit: true });
    const restart = {
      sessionId: running.sessionId,
      expectedHostId: hostId,
      generation: 1,
      cwd: home,
      argv: ['/bin/sh', '-c', 'exit 4'],
      retainOnExit: true,
    };
    expect(await rejected('session.restart', restart)).toBe('RUNNING');
    const exited = await create({
      label: 'done',
      argv: ['/bin/sh', '-c', 'exit 3'],
      retainOnExit: true,
    });
    const { sessionId } = exited;
    await until(
      () => call('session.inspect', { sessionId }) as Promise<MuxSummary>,
      (s) => s.processState === 'exited'
    );
    expect(
      await call('session.restart', { ...restart, sessionId })
    ).toMatchObject({ generation: 2 });
    expect(await rejected('session.restart', { ...restart, sessionId })).toBe(
      'STALE_GENERATION'
    );
  });

  it('moves a target claim between sessions in one step', async () => {
    const first = await create({ label: 'a' });
    const second = await create({ label: 'b' });
    const claim = (sessionId: string) =>
      call('session.metadata', {
        sessionId,
        expectedHostId: hostId,
        claimTarget: 'claude:abc',
      });
    await claim(first.sessionId);
    expect(await claim(second.sessionId)).toMatchObject({
      tags: { '@orchestra-target': 'claude:abc' },
    });
    const { tags } = (await call('session.inspect', {
      sessionId: first.sessionId,
    })) as MuxSummary;
    expect(tags['@orchestra-target']).toBeUndefined();
  });

  it('stops the exact session it names', async () => {
    const { sessionId } = await create({});
    const stop = { sessionId, expectedHostId: hostId, generation: 1 };
    expect(
      await rejected('session.stop', { ...stop, expectedHostId: 'x' })
    ).toBe('IDENTITY_MISMATCH');
    expect(await call('session.stop', stop)).toEqual({});
    expect(await rejected('session.inspect', { sessionId })).toBe('NOT_FOUND');
  });

  it('answers a session about itself only while it is that process', async () => {
    const { sessionId } = await create({});
    expect(
      await call('session.self', { hostId, sessionId, generation: 1 })
    ).toMatchObject({ sessionId });
    expect(
      await rejected('session.self', { hostId, sessionId, generation: 2 })
    ).toBe('STALE_GENERATION');
    expect(
      await rejected('session.self', {
        hostId: 'previous-owner',
        sessionId,
        generation: 1,
      })
    ).toBe('IDENTITY_MISMATCH');
  });
});

describe('the wire', () => {
  async function exchange(lines: string): Promise<unknown[]> {
    const { socket } = await connectMux(muxRuntime());
    const reader = new FrameReader();
    const replies: unknown[] = [];
    socket.on('data', (chunk: Buffer) => {
      for (const line of reader.push(chunk)) replies.push(JSON.parse(line));
    });
    socket.resume();
    socket.write(lines);
    await until(
      async () => replies.length,
      (n) => n > 0
    );
    socket.destroy();
    return replies;
  }

  it('answers a malformed request with an error, not silence', async () => {
    expect(await exchange('nonsense\n')).toEqual([
      {
        id: 0,
        ok: false,
        error: { code: 'INVALID_REQUEST', message: 'Not JSON' },
      },
    ]);
    expect(
      await exchange('{"v":2,"id":7,"op":"host.status","params":{}}\n')
    ).toMatchObject([
      { id: 7, ok: false, error: { code: 'VERSION_UNSUPPORTED' } },
    ]);
  });

  it('refuses a frame over 1 MiB and closes', async () => {
    expect(await exchange('x'.repeat(1024 * 1024 + 1))).toMatchObject([
      { ok: false, error: { code: 'INVALID_REQUEST' } },
    ]);
  });
});
