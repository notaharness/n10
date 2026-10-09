import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Socket } from 'node:net';
import { MuxError } from './mux-error.js';

/**
 * Mutual HMAC-SHA256 authentication over a fresh local connection.
 *
 * 1. The owner sends only `{"nonce"}`: nothing about sessions, paths or
 *    itself before the client has proved it holds the secret.
 * 2. The client answers with its own nonce and a proof over both
 *    nonces, the protocol and the host id it expects.
 * 3. The owner checks that proof in constant time and answers with its
 *    own, separately labelled proof, or closes the connection.
 * 4. The client checks the owner's proof before it sends anything else.
 *
 * A server squatting on the endpoint cannot produce step 3, and a
 * recorded client proof is bound to a nonce the owner never reuses.
 */
export const MUX_PROTOCOL = 'n10-mux-v1';
export const MUX_VERSION = 1;

export interface MuxCredentials {
  hostId: string;
  secret: Buffer;
}

/** How long either side waits for the other's handshake line. */
export const HANDSHAKE_TIMEOUT_MS = 5_000;
/** No handshake line is longer than this. */
const MAX_HANDSHAKE_LINE = 4096;
const NONCE_BYTES = 32;

type Role = 'client' | 'server';

function proof(
  role: Role,
  secret: Buffer,
  serverNonce: string,
  clientNonce: string,
  hostId: string
): Buffer {
  return createHmac('sha256', secret)
    .update(
      JSON.stringify([MUX_PROTOCOL, role, serverNonce, clientNonce, hostId])
    )
    .digest();
}

function matches(expected: Buffer, sent: unknown): boolean {
  if (typeof sent !== 'string') return false;
  const actual = Buffer.from(sent, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const nonce = () => randomBytes(NONCE_BYTES).toString('base64');

/** The owner's side. Resolves with whatever followed the client's
 *  proof; rejects, and destroys the socket, if the client fails. */
export async function acceptMuxClient(
  socket: Socket,
  credentials: MuxCredentials,
  timeoutMs = HANDSHAKE_TIMEOUT_MS
): Promise<Buffer> {
  const lines = lineReader(socket, timeoutMs);
  try {
    const serverNonce = nonce();
    socket.write(`${JSON.stringify({ nonce: serverNonce })}\n`);
    const hello = await lines.next();
    const sent = parse(hello.line);
    if (sent.v !== MUX_VERSION || sent.hostId !== credentials.hostId)
      throw new MuxError('AUTH_FAILED', 'Client named another mux owner');
    if (typeof sent.nonce !== 'string' || sent.nonce.length === 0)
      throw new MuxError('AUTH_FAILED', 'Client sent no nonce');
    const expected = proof(
      'client',
      credentials.secret,
      serverNonce,
      sent.nonce,
      credentials.hostId
    );
    if (!matches(expected, sent.proof))
      throw new MuxError('AUTH_FAILED', 'Client proof did not verify');
    const answer = proof(
      'server',
      credentials.secret,
      serverNonce,
      sent.nonce,
      credentials.hostId
    ).toString('base64');
    socket.write(`${JSON.stringify({ proof: answer })}\n`);
    return hello.rest;
  } catch (err) {
    socket.destroy();
    throw err;
  } finally {
    lines.release();
  }
}

/** The client's side. Resolves once the owner proved it holds the
 *  same secret; nothing else is sent before that. */
export async function authenticateToMux(
  socket: Socket,
  credentials: MuxCredentials,
  timeoutMs = HANDSHAKE_TIMEOUT_MS
): Promise<Buffer> {
  const lines = lineReader(socket, timeoutMs);
  try {
    const greeting = parse((await lines.next()).line);
    if (typeof greeting.nonce !== 'string' || greeting.nonce.length === 0)
      throw new MuxError('AUTH_FAILED', 'Mux owner sent no nonce');
    const clientNonce = nonce();
    const sent = proof(
      'client',
      credentials.secret,
      greeting.nonce,
      clientNonce,
      credentials.hostId
    ).toString('base64');
    socket.write(
      `${JSON.stringify({
        v: MUX_VERSION,
        hostId: credentials.hostId,
        nonce: clientNonce,
        proof: sent,
      })}\n`
    );
    const reply = await lines.next();
    const expected = proof(
      'server',
      credentials.secret,
      greeting.nonce,
      clientNonce,
      credentials.hostId
    );
    if (!matches(expected, parse(reply.line).proof))
      throw new MuxError('AUTH_FAILED', 'Mux owner proof did not verify');
    return reply.rest;
  } catch (err) {
    socket.destroy();
    throw err;
  } finally {
    lines.release();
  }
}

function parse(line: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(line);
    if (value && typeof value === 'object' && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // reported below
  }
  throw new MuxError('AUTH_FAILED', 'Malformed handshake line');
}

interface LineReader {
  /** The next LF-terminated line and the bytes after it. */
  next(): Promise<{ line: string; rest: Buffer }>;
  /** Stop listening; the socket stays open. */
  release(): void;
}

/** Bounded handshake lines, each within `timeoutMs`. A connection that
 *  ends, errors or overruns first fails as an authentication failure. */
function lineReader(socket: Socket, timeoutMs: number): LineReader {
  let buffered = Buffer.alloc(0);
  let waiting: {
    resolve: (value: { line: string; rest: Buffer }) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;
  let failure: Error | null = null;

  const settle = () => {
    if (!waiting) return;
    const end = buffered.indexOf(0x0a);
    if (end >= 0) {
      const { resolve, timer } = waiting;
      waiting = null;
      clearTimeout(timer);
      const line = buffered.subarray(0, end).toString('utf8');
      const rest = buffered.subarray(end + 1);
      buffered = Buffer.alloc(0);
      resolve({ line, rest });
    } else if (buffered.length > MAX_HANDSHAKE_LINE) {
      fail(new MuxError('AUTH_FAILED', 'Handshake line too long'));
    } else if (failure) {
      fail(failure);
    }
  };
  const fail = (err: Error) => {
    failure ??= err;
    if (!waiting) return;
    const { reject, timer } = waiting;
    waiting = null;
    clearTimeout(timer);
    reject(err);
  };
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    settle();
  };
  const onEnd = () =>
    fail(new MuxError('AUTH_FAILED', 'Connection closed during handshake'));
  const onError = (err: Error) =>
    fail(new MuxError('AUTH_FAILED', `Connection failed: ${err.message}`));
  socket.on('data', onData);
  socket.on('end', onEnd);
  socket.on('close', onEnd);
  socket.on('error', onError);

  return {
    next: () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => fail(new MuxError('AUTH_FAILED', 'Handshake timed out')),
          timeoutMs
        );
        waiting = { resolve, reject, timer };
        settle();
      }),
    // Paused, so nothing arriving before the caller listens is lost.
    release: () => {
      socket.pause();
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('close', onEnd);
      socket.off('error', onError);
      if (waiting) clearTimeout(waiting.timer);
    },
  };
}
