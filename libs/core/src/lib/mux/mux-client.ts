import type { MuxRuntime } from './mux-endpoint.js';
import { isMuxErrorCode, MuxError } from './mux-error.js';
import { connectMux } from './mux-ipc.js';
import {
  frame,
  FrameReader,
  LIMITS,
  MUTATING_OPS,
  WIRE_VERSION,
  type MuxOp,
} from './mux-protocol.js';

/** What one request returned: its result, and the records a batch
 *  sent before it. */
export interface MuxResponse {
  result: unknown;
  parts: unknown[];
}

/**
 * Send one request to the running owner and read its whole answer
 * before returning any of it, so a batch that fails is never mistaken
 * for a shorter one. A mutation whose reply the connection lost is
 * `OUTCOME_UNKNOWN`: it may have happened, and is not retried.
 */
export async function muxRequest(
  runtime: MuxRuntime,
  op: MuxOp,
  params: Record<string, unknown>
): Promise<MuxResponse> {
  const { socket, rest } = await connectMux(runtime);
  const lost = () =>
    MUTATING_OPS.has(op)
      ? new MuxError(
          'OUTCOME_UNKNOWN',
          'The connection closed before the owner answered; the change may have happened'
        )
      : new MuxError('HOST_NOT_RUNNING', 'The owner closed the connection');
  return new Promise<MuxResponse>((resolve, reject) => {
    const reader = new FrameReader();
    const parts: unknown[] = [];
    let partBytes = 0;
    let settled = false;
    const finish = (error: Error | null, result?: unknown) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve({ result, parts });
    };
    const reply = (line: string) => {
      const message = JSON.parse(line) as {
        ok?: boolean;
        part?: unknown;
        result?: unknown;
        error?: { code?: unknown; message?: unknown };
      };
      if (message.ok && 'part' in message) {
        partBytes += Buffer.byteLength(line);
        if (partBytes > LIMITS.batchBytes)
          return finish(new MuxError('OUTPUT_LIMIT', 'More than 16 MiB'));
        parts.push(message.part);
        return;
      }
      if (message.ok) return finish(null, message.result);
      const code = message.error?.code;
      finish(
        new MuxError(
          isMuxErrorCode(code) ? code : 'UNSUPPORTED',
          String(message.error?.message ?? 'The owner refused the request')
        )
      );
    };
    const receive = (chunk: Buffer) => {
      try {
        for (const line of reader.push(chunk)) reply(line);
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };
    socket.on('data', receive);
    socket.on('error', () => finish(lost()));
    socket.on('close', () => finish(lost()));
    if (rest.length > 0) receive(rest);
    // The handshake leaves the socket paused, so nothing was lost.
    socket.resume();
    socket.write(frame({ v: WIRE_VERSION, id: 1, op, params }));
  });
}
