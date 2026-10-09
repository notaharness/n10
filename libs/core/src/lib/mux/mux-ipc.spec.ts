import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authenticateToMux } from './mux-auth.js';
import {
  ensureRuntimeDir,
  muxRuntime,
  readCredentials,
  type MuxRuntime,
} from './mux-endpoint.js';
import {
  connectMux,
  listenMux,
  type AuthenticatedConnection,
  type MuxOwner,
} from './mux-ipc.js';
import { lockRuntime } from './runtime-lock.js';

/** Real sockets: a named pipe on Windows, a Unix socket elsewhere. */
const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function runtime(): MuxRuntime {
  const home = mkdtempSync(join(tmpdir(), 'n10-mux-'));
  cleanup.push(() => rmSync(home, { recursive: true, force: true }));
  return muxRuntime({ HOME: home, LOCALAPPDATA: home });
}

async function own(
  at: MuxRuntime,
  onClient: (c: AuthenticatedConnection) => void = (c) => echo(c)
): Promise<MuxOwner> {
  const result = await listenMux(at, onClient);
  if (result.kind !== 'owner') throw new Error('expected to own the mux');
  cleanup.push(() => result.owner.close());
  return result.owner;
}

/** An authenticated owner that answers each line with `pong:<line>`. */
function echo({ socket }: AuthenticatedConnection): void {
  socket.on('data', (chunk: Buffer) =>
    socket.write(`pong:${chunk.toString()}`)
  );
  socket.resume();
}

function raw(
  endpoint: string
): Promise<{ socket: Socket; received: () => string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    let text = '';
    socket.on('data', (chunk) => (text += chunk.toString()));
    socket.once('error', reject);
    socket.once('connect', () => resolve({ socket, received: () => text }));
    cleanup.push(() => socket.destroy());
  });
}

const closed = (socket: Socket) =>
  new Promise<void>((resolve) => {
    if (socket.destroyed) resolve();
    else socket.once('close', () => resolve());
  });

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('mux IPC', () => {
  it('authenticates both ways, then carries the protocol', async () => {
    const at = runtime();
    const owner = await own(at);
    const client = await connectMux(at);
    cleanup.push(() => client.socket.destroy());
    expect(client.hostId).toBe(owner.hostId);
    const reply = new Promise<string>((resolve) =>
      client.socket.once('data', (chunk: Buffer) => resolve(chunk.toString()))
    );
    client.socket.resume();
    client.socket.write('ping\n');
    expect(await reply).toBe('pong:ping\n');
  });

  it('says nothing but a nonce before the client proves itself', async () => {
    const at = runtime();
    await own(at);
    const { received } = await raw(at.endpoint);
    await delay(300);
    const lines = received().split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(Object.keys(JSON.parse(lines[0]!) as object)).toEqual(['nonce']);
  });

  it('closes on a client without the secret and admits nothing', async () => {
    const at = runtime();
    let admitted = 0;
    const owner = await own(at, () => admitted++);
    const socket = await raw(at.endpoint).then((r) => r.socket);
    await expect(
      authenticateToMux(socket, {
        hostId: owner.hostId,
        secret: Buffer.alloc(32, 7),
      })
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(admitted).toBe(0);
  });

  it('refuses a replayed client proof', async () => {
    const at = runtime();
    let admitted = 0;
    await own(at, (c) => {
      admitted++;
      c.socket.destroy();
    });
    // Record what a genuine client sends on one connection...
    const credentials = readCredentials(at);
    const first = await raw(at.endpoint);
    const sent: string[] = [];
    const write = first.socket.write.bind(first.socket);
    first.socket.write = ((chunk: string) => {
      sent.push(chunk);
      return write(chunk);
    }) as typeof first.socket.write;
    await authenticateToMux(first.socket, credentials);
    expect(admitted).toBe(1);
    // ...and send it again against a fresh nonce.
    const second = await raw(at.endpoint);
    await delay(100);
    const before = second.received();
    second.socket.write(sent[0]!);
    await closed(second.socket);
    expect(second.received()).toBe(before);
    expect(admitted).toBe(1);
  });

  /** A server on its own endpoint that greets like an owner and answers
   *  the client's proof line with `answer(line)`; it records each line. */
  async function squatter(
    at: MuxRuntime,
    answer: (line: { proof?: string }) => string
  ): Promise<{ endpoint: string; lines: string[] }> {
    const lines: string[] = [];
    const server: Server = createServer((socket) => {
      socket.on('error', () => socket.destroy());
      socket.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString().split('\n').filter(Boolean)) {
          lines.push(line);
          socket.write(
            `${JSON.stringify({
              proof: answer(JSON.parse(line) as { proof?: string }),
            })}\n`
          );
        }
      });
      socket.write(`${JSON.stringify({ nonce: 'squatter' })}\n`);
    });
    const endpoint =
      process.platform === 'win32'
        ? `${at.endpoint}-squatter`
        : join(at.dir, 'squatter.sock');
    await new Promise<void>((resolve) => server.listen(endpoint, resolve));
    cleanup.push(() => new Promise((r) => server.close(r)));
    return { endpoint, lines };
  }

  it.each([
    ['a proof of its own making', () => Buffer.alloc(32).toString('base64')],
    // The role label in the HMAC is what tells the two proofs apart.
    [
      "the client's own proof reflected",
      (line: { proof?: string }) => line.proof ?? '',
    ],
  ])(
    'never sends a request to a server answering with %s',
    async (_, answer) => {
      const at = runtime();
      const owner = await own(at);
      const credentials = readCredentials(at);
      const { endpoint, lines } = await squatter(at, answer);
      const socket = await raw(endpoint).then((r) => r.socket);
      await expect(
        authenticateToMux(socket, { ...credentials, hostId: owner.hostId })
      ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
      expect(lines).toHaveLength(1);
    }
  );

  it('waits out an owner that has bound but not yet published', async () => {
    const at = runtime();
    const owner = await own(at);
    const published = readFileSync(join(at.dir, 'mux.json'));
    // What a client finds in that moment: no credentials, then the
    // previous owner's, then this owner's.
    rmSync(join(at.dir, 'mux.json'));
    setTimeout(() => {
      writeFileSync(
        join(at.dir, 'mux.json'),
        JSON.stringify({ v: 1, hostId: 'previous', secret: 'AAAA' })
      );
      setTimeout(() => writeFileSync(join(at.dir, 'mux.json'), published), 200);
    }, 200);
    const client = await connectMux(at);
    client.socket.destroy();
    expect(client.hostId).toBe(owner.hostId);
  });

  it('elects one owner from concurrent starts; the rest find it', async () => {
    const at = runtime();
    const results = await Promise.all(
      [1, 2, 3].map(() => listenMux(at, (c) => echo(c)))
    );
    const owners = results.flatMap((r) =>
      r.kind === 'owner' ? [r.owner] : []
    );
    for (const owner of owners) cleanup.push(() => owner.close());
    expect(owners).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'existing')).toEqual([
      { kind: 'existing', hostId: owners[0]!.hostId },
      { kind: 'existing', hostId: owners[0]!.hostId },
    ]);
  });

  it('finds the running owner instead of replacing it', async () => {
    const at = runtime();
    const owner = await own(at);
    const second = await listenMux(at, () => undefined);
    expect(second).toEqual({ kind: 'existing', hostId: owner.hostId });
    const client = await connectMux(at);
    client.socket.destroy();
    expect(client.hostId).toBe(owner.hostId);
  });

  it('reports an endpoint held by something that cannot authenticate', async () => {
    const at = runtime();
    const first = await own(at);
    await first.close();
    cleanup.pop();
    // The old owner's credentials remain; a squatter takes the endpoint.
    const squatter = createServer((socket) => {
      socket.on('error', () => socket.destroy());
      socket.write(`${JSON.stringify({ nonce: 'x' })}\n`);
      socket.on('data', () =>
        socket.write(`${JSON.stringify({ proof: 'forged' })}\n`)
      );
    });
    await new Promise<void>((resolve) => squatter.listen(at.endpoint, resolve));
    cleanup.push(() => new Promise((r) => squatter.close(r)));
    await expect(listenMux(at, () => undefined)).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });
    expect(squatter.listening).toBe(true);
  });

  describe.skipIf(process.platform === 'win32')('after a crashed owner', () => {
    /** A socket bound by a process that is then SIGKILLed: the file
     *  stays, nobody listens. */
    async function crashedOwner(at: MuxRuntime): Promise<number> {
      ensureRuntimeDir(at);
      const child = spawn(
        process.execPath,
        [
          '-e',
          "require('net').createServer().listen(process.argv[1], () => console.log('bound'))",
          at.endpoint,
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] }
      );
      await new Promise((resolve) => child.stdout.once('data', resolve));
      child.kill('SIGKILL');
      await new Promise((resolve) => child.once('exit', resolve));
      return lstatSync(at.endpoint).ino;
    }

    it('one of two concurrent starters takes over; the other finds it', async () => {
      const at = runtime();
      await crashedOwner(at);
      const results = await Promise.all(
        [1, 2].map(() => listenMux(at, (c) => echo(c)))
      );
      const owners = results.flatMap((r) =>
        r.kind === 'owner' ? [r.owner] : []
      );
      for (const owner of owners) cleanup.push(() => owner.close());
      expect(owners).toHaveLength(1);
      expect(results).toContainEqual({
        kind: 'existing',
        hostId: owners[0]!.hostId,
      });
      // The live socket is the winner's: a client reaches it.
      const client = await connectMux(at);
      client.socket.destroy();
      expect(client.hostId).toBe(owners[0]!.hostId);
    });

    it('removes the dead socket only while holding the startup lock', async () => {
      const at = runtime();
      const dead = await crashedOwner(at);
      const held = await lockRuntime(at);
      let settled = false;
      const starting = listenMux(at, () => undefined).finally(() => {
        settled = true;
      });
      await delay(300);
      expect(settled).toBe(false);
      expect(lstatSync(at.endpoint).ino).toBe(dead);
      held.release();
      const result = await starting;
      if (result.kind === 'owner') cleanup.push(() => result.owner.close());
      expect(result.kind).toBe('owner');
    });
  });

  it('answers HOST_NOT_RUNNING when no owner ever ran', async () => {
    await expect(connectMux(runtime())).rejects.toMatchObject({
      code: 'HOST_NOT_RUNNING',
    });
  });

  it.skipIf(process.platform === 'win32')(
    'keeps the runtime directory and secret private',
    async () => {
      const at = runtime();
      await own(at);
      expect(statSync(at.dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(at.dir, 'mux.json')).mode & 0o777).toBe(0o600);
    }
  );
});
