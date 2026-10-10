import type { AuthenticatedConnection } from './mux-ipc.js';
import { MuxError } from './mux-error.js';
import {
  errorReply,
  frame,
  FrameReader,
  LIMITS,
  MUX_OPS,
  WIRE_VERSION,
  type MuxOp,
  type MuxReply,
  type RequestId,
} from './mux-protocol.js';
import type { MuxSessions } from './mux-sessions.js';

interface Parsed {
  id: RequestId;
  op: MuxOp;
  params: Record<string, unknown>;
}

function isRequestId(id: unknown): id is RequestId {
  return typeof id === 'string' || (typeof id === 'number' && isFinite(id));
}

function parse(line: string): Parsed | { id: RequestId; error: MuxError } {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return { id: 0, error: new MuxError('INVALID_REQUEST', 'Not JSON') };
  }
  const { v, id, op, params } = (message ?? {}) as Record<string, unknown>;
  const replyId = isRequestId(id) ? id : 0;
  if (v !== WIRE_VERSION)
    return {
      id: replyId,
      error: new MuxError('VERSION_UNSUPPORTED', `Wire version ${String(v)}`),
    };
  if (!isRequestId(id))
    return { id: 0, error: new MuxError('INVALID_REQUEST', 'No request id') };
  if (!MUX_OPS.includes(op as MuxOp))
    return {
      id,
      error: new MuxError('INVALID_REQUEST', `No op ${String(op)}`),
    };
  if (params !== undefined && (typeof params !== 'object' || params === null))
    return { id, error: new MuxError('INVALID_REQUEST', 'params') };
  return {
    id,
    op: op as MuxOp,
    params: (params ?? {}) as Record<string, unknown>,
  };
}

/**
 * Answer an authenticated client's requests until it disconnects. A
 * malformed frame is answered with an error; one too long to frame
 * ends the connection, since nothing after it can be trusted.
 */
export function serveMuxConnection(
  { socket, rest }: AuthenticatedConnection,
  sessions: MuxSessions
): void {
  const reader = new FrameReader();
  let outstanding = 0;
  const send = (reply: MuxReply) => {
    if (socket.destroyed) return;
    const text = frame(reply);
    socket.write(
      Buffer.byteLength(text) > LIMITS.frameBytes
        ? frame(
            errorReply(
              reply.id,
              new MuxError('OUTPUT_LIMIT', 'The reply exceeds 1 MiB')
            )
          )
        : text
    );
  };
  const handle = (line: string) => {
    const request = parse(line);
    if ('error' in request) return send(errorReply(request.id, request.error));
    if (outstanding >= LIMITS.outstanding)
      return send(
        errorReply(
          request.id,
          new MuxError('INVALID_REQUEST', 'Too many outstanding requests')
        )
      );
    outstanding += 1;
    answer(request)
      .catch(() => socket.destroy())
      .finally(() => (outstanding -= 1));
  };
  const answer = async ({ id, op, params }: Parsed) => {
    try {
      const result = await sessions.call(op, params, (part) =>
        send({ id, ok: true, part })
      );
      send({ id, ok: true, result });
    } catch (err) {
      send(errorReply(id, err));
    }
  };
  const receive = (chunk: Buffer) => {
    try {
      for (const line of reader.push(chunk)) handle(line);
    } catch (err) {
      send(errorReply(0, err));
      socket.end();
    }
  };
  socket.on('data', receive);
  if (rest.length > 0) receive(rest);
  // The handshake leaves the socket paused, so nothing was lost.
  socket.resume();
}
