import { MuxError, type MuxErrorCode } from './mux-error.js';

/**
 * Wire v1: after the handshake, LF-framed JSON. A request is
 * `{v:1,id,op,params}`; its reply `{id,ok:true,result}` or
 * `{id,ok:false,error:{code,message}}`. A batch sends its records as
 * `{id,ok:true,part}` frames before the result that completes it.
 */
export const WIRE_VERSION = 1;

export const LIMITS = {
  /** One frame, either way. */
  frameBytes: 1024 * 1024,
  /** Text one send carries. */
  messageBytes: 256 * 1024,
  tagKeys: 64,
  tagBytes: 4096,
  /** Requests one connection may have unanswered. */
  outstanding: 32,
  minDimension: 2,
  maxDimension: 500,
  /** One capture's UTF-8 text. */
  captureBytes: 512 * 1024,
  /** Everything one batch returns. */
  batchBytes: 16 * 1024 * 1024,
} as const;

export const MUX_OPS = [
  'host.status',
  'session.list',
  'session.inspect',
  'session.self',
  'session.create',
  'session.restart',
  'session.metadata',
  'session.send',
  'session.capture',
  'session.stop',
] as const;

export type MuxOp = (typeof MUX_OPS)[number];

/** Operations that change something: a reply lost to the connection
 *  leaves their outcome unknown. */
export const MUTATING_OPS: ReadonlySet<MuxOp> = new Set<MuxOp>([
  'session.create',
  'session.restart',
  'session.metadata',
  'session.send',
  'session.stop',
]);

export type RequestId = string | number;

export interface MuxRequest {
  v: number;
  id: RequestId;
  op: MuxOp;
  params: Record<string, unknown>;
}

export type MuxReply =
  | { id: RequestId; ok: true; result: unknown }
  | { id: RequestId; ok: true; part: unknown }
  | {
      id: RequestId;
      ok: false;
      error: { code: MuxErrorCode; message: string };
    };

export type OwnerType = 'desktop' | 'tui' | 'headless';

/** `host.status`: what a client may know about the owner. */
export interface MuxStatus {
  protocolVersion: number;
  hostId: string;
  ownerType: OwnerType;
  os: NodeJS.Platform;
  sessionCount: number;
  capabilities: string[];
}

/** A capture of one session's screen. */
export interface MuxCapture {
  text: string;
  seq: number;
  generation: number;
  truncated: boolean;
  alternateScreen: boolean;
}

/** One session as every summary verb returns it. */
export interface MuxSummary {
  sessionId: string;
  hostId: string;
  generation: number;
  label: string;
  /** Epoch seconds. */
  createdAt: number;
  cwd: string;
  processState: 'running' | 'exited';
  pid: number | null;
  exitCode: number | null;
  cols: number;
  rows: number;
  /** Epoch seconds; creation until the first output. */
  lastOutputAt: number;
  launchKind: 'shell' | 'agent' | 'unknown';
  launchAgent: string | null;
  tags: Record<string, string>;
  title: string;
  requestId: string | null;
  /** `session.list` with `capture` only. */
  capture?: MuxCapture;
}

/**
 * Splits a stream into LF-terminated frames, refusing one longer than
 * the frame limit rather than buffering without bound.
 */
export class FrameReader {
  private buffered: Buffer = Buffer.alloc(0);

  constructor(private readonly limit: number = LIMITS.frameBytes) {}

  /** The complete frames `chunk` finishes; throws `INVALID_REQUEST`
   *  once a frame outgrows the limit. */
  push(chunk: Buffer): string[] {
    this.buffered = Buffer.concat([this.buffered, chunk]);
    const frames: string[] = [];
    for (;;) {
      const end = this.buffered.indexOf(0x0a);
      if (end === -1 ? this.buffered.length > this.limit : end > this.limit)
        throw new MuxError('INVALID_REQUEST', 'A frame exceeds 1 MiB');
      if (end === -1) return frames;
      frames.push(this.buffered.subarray(0, end).toString('utf8'));
      this.buffered = this.buffered.subarray(end + 1);
    }
  }
}

/** One frame, LF-terminated. */
export function frame(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

export function errorReply(id: RequestId, err: unknown): MuxReply {
  if (err instanceof MuxError)
    return { id, ok: false, error: { code: err.code, message: err.message } };
  return {
    id,
    ok: false,
    error: {
      code: 'UNSUPPORTED',
      message: err instanceof Error ? err.message : String(err),
    },
  };
}
