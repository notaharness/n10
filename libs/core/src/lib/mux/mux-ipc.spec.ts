import { mkdtempSync, rmSync, statSync } from 'node:fs';
import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { authenticateToMux } from './mux-auth.js';
import {
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

  it('never sends a request to a server that cannot prove the secret', async () => {
    const at = runtime();
    const owner = await own(at);
    const credentials = readCredentials(at);
    // A squatter answers the handshake with a proof of its own making.
    const lines: string[] = [];
    const squatter: Server = createServer((socket) => {
      socket.on('data', (chunk) => {
        lines.push(...chunk.toString().split('\n').filter(Boolean));
        socket.write(
          `${JSON.stringify({ proof: Buffer.alloc(32).toString('base64') })}\n`
        );
      });
      socket.write(`${JSON.stringify({ nonce: 'squatter' })}\n`);
    });
    const endpoint =
      process.platform === 'win32'
        ? `${at.endpoint}-squatter`
        : join(at.dir, 'squatter.sock');
    await new Promise<void>((resolve) => squatter.listen(endpoint, resolve));
    cleanup.push(() => new Promise((r) => squatter.close(r)));
    const socket = await raw(endpoint).then((r) => r.socket);
    await expect(
      authenticateToMux(socket, { ...credentials, hostId: owner.hostId })
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });
    expect(lines).toHaveLength(1);
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
