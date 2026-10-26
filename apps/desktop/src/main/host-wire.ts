/**
 * The session host's protocol on a byte stream: what `host-protocol.ts`
 * messages become when the host runs behind a pipe (`n10 host --stdio`
 * in WSL or over SSH) rather than as a utility process.
 *
 * One message per line, each starting with `FRAME`. The host's first
 * line is `HELLO` with a `HostHello`. Anything else on the stream is
 * noise: what a login shell's startup files print before the host
 * runs, or a stray write, and the reader hands it back as such rather
 * than failing. Stdout carries only this; the host logs to stderr.
 *
 * JSON stands in for the structured clone a utility process gets, so
 * the two things the contract sends that JSON would lose are tagged:
 * byte arrays (pasted images) and `undefined` in an argument list,
 * which JSON would turn into `null`.
 */

/** Bumped whenever a message's shape changes: a frontend and a host
 *  speaking different versions refuse each other. */
export const HOST_PROTOCOL = 2;

export const FRAME = '\x1eN10 ';
export const HELLO = '\x1eN10HELLO ';

/** A line longer than this is a broken stream, not a message. */
export const MAX_LINE_BYTES = 256 * 1024 * 1024;

/** What the host says first. */
export interface HostHello {
  protocol: number;
  /** The n10 version the host runs. */
  version: string;
  platform: NodeJS.Platform;
  home: string;
  /** `WSL_DISTRO_NAME`, inside WSL. */
  distro?: string;
  /** The script node ran (`process.argv[1]`): where n10 is installed. */
  entry?: string;
}

const TAG = '$n10';

type Tagged = { [TAG]: 'u8'; b64: string } | { [TAG]: 'undef' };

function replacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown>)[key];
  if (raw instanceof Uint8Array) {
    const b64 = Buffer.from(
      raw.buffer,
      raw.byteOffset,
      raw.byteLength
    ).toString('base64');
    return { [TAG]: 'u8', b64 } satisfies Tagged;
  }
  if (raw === undefined && Array.isArray(this)) {
    return { [TAG]: 'undef' } satisfies Tagged;
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value === null || typeof value !== 'object' || !(TAG in value)) {
    return value;
  }
  const tagged = value as Tagged;
  if (tagged[TAG] === 'u8') {
    return new Uint8Array(Buffer.from(tagged.b64, 'base64'));
  }
  // Leaves a hole: an argument spread from it is `undefined` again.
  return undefined;
}

export function encodeFrame(message: unknown): string {
  return `${FRAME}${JSON.stringify(message, replacer)}\n`;
}

export function encodeHello(hello: HostHello): string {
  return `${HELLO}${JSON.stringify(hello)}\n`;
}

export function decodeFrame(json: string): unknown {
  return JSON.parse(json, reviver);
}

export type WireLine =
  | { kind: 'message'; message: unknown }
  | { kind: 'hello'; hello: HostHello }
  | { kind: 'noise'; text: string };

export function parseLine(line: string): WireLine {
  try {
    if (line.startsWith(FRAME)) {
      return {
        kind: 'message',
        message: decodeFrame(line.slice(FRAME.length)),
      };
    }
    if (line.startsWith(HELLO)) {
      return {
        kind: 'hello',
        hello: JSON.parse(line.slice(HELLO.length)) as HostHello,
      };
    }
  } catch {
    // A frame that does not parse is reported, not obeyed.
  }
  return { kind: 'noise', text: line };
}

/**
 * Splits a byte stream into lines. Chunks are kept as bytes until a
 * line ends, so a character split between chunks decodes whole. A line
 * past `MAX_LINE_BYTES` calls `overflow` and ends the reader.
 */
export function lineReader(
  onLine: (line: string) => void,
  overflow: () => void,
  max = MAX_LINE_BYTES
): (chunk: Buffer) => void {
  let parts: Buffer[] = [];
  let size = 0;
  let dead = false;
  return (chunk) => {
    if (dead) return;
    let start = 0;
    for (;;) {
      const end = chunk.indexOf(0x0a, start);
      if (end === -1) break;
      parts.push(chunk.subarray(start, end));
      const line = Buffer.concat(parts).toString('utf8');
      parts = [];
      size = 0;
      onLine(line.endsWith('\r') ? line.slice(0, -1) : line);
      start = end + 1;
    }
    if (start < chunk.length) {
      parts.push(chunk.subarray(start));
      size += chunk.length - start;
      if (size > max) {
        dead = true;
        parts = [];
        overflow();
      }
    }
  };
}
