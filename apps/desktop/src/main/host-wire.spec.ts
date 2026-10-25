import { describe, expect, it, vi } from 'vitest';
import {
  encodeFrame,
  encodeHello,
  FRAME,
  HOST_PROTOCOL,
  lineReader,
  parseLine,
} from './host-wire.js';

const roundTrip = (message: unknown) => {
  const parsed = parseLine(encodeFrame(message).slice(0, -1));
  if (parsed.kind !== 'message')
    throw new Error(`not a message: ${parsed.kind}`);
  return parsed.message;
};

describe('host wire frames', () => {
  it('carries byte arrays as bytes, as a utility process would', () => {
    const data = new Uint8Array([0, 1, 254, 255, 10, 13]);
    const out = roundTrip({ t: 'invoke', args: [data, 'image/png'] }) as {
      args: [Uint8Array, string];
    };
    expect(out.args[0]).toBeInstanceOf(Uint8Array);
    expect([...out.args[0]]).toEqual([...data]);
    expect(out.args[1]).toBe('image/png');
  });

  it('carries a view on part of a buffer as just that part', () => {
    const whole = new Uint8Array([9, 9, 1, 2, 9]);
    const out = roundTrip([whole.subarray(2, 4)]) as [Uint8Array];
    expect([...out[0]]).toEqual([1, 2]);
  });

  it('keeps an undefined argument undefined rather than null', () => {
    const out = roundTrip({ args: ['/repo', undefined, 3] }) as {
      args: unknown[];
    };
    expect(out.args).toHaveLength(3);
    expect(out.args[1]).toBeUndefined();
    expect([...out.args]).toEqual(['/repo', undefined, 3]);
  });

  it('drops an undefined property, as a structured clone keeps it absent', () => {
    expect(roundTrip({ t: 'result', value: undefined })).toEqual({
      t: 'result',
    });
  });

  it('keeps every frame on one line', () => {
    const frame = encodeFrame({ data: 'a\nb\r\nc' });
    expect(frame.indexOf('\n')).toBe(frame.length - 1);
  });

  it('reads the hello', () => {
    const hello = {
      protocol: HOST_PROTOCOL,
      version: '1.0.0',
      platform: 'linux' as const,
      home: '/home/me',
      distro: 'Ubuntu',
    };
    expect(parseLine(encodeHello(hello).slice(0, -1))).toEqual({
      kind: 'hello',
      hello,
    });
  });

  it('treats a login shell’s output and a broken frame as noise', () => {
    expect(parseLine('Welcome to Ubuntu')).toEqual({
      kind: 'noise',
      text: 'Welcome to Ubuntu',
    });
    expect(parseLine(`${FRAME}{not json`).kind).toBe('noise');
  });
});

describe('lineReader', () => {
  it('joins lines split across chunks, multi-byte characters included', () => {
    const lines: string[] = [];
    const read = lineReader(
      (l) => lines.push(l),
      () => undefined
    );
    const bytes = Buffer.from('één\r\ntwo\nthr');
    read(bytes.subarray(0, 1));
    read(bytes.subarray(1, 9));
    read(bytes.subarray(9));
    read(Buffer.from('ee\n'));
    expect(lines).toEqual(['één', 'two', 'three']);
  });

  it('gives up on a line past its limit', () => {
    const lines: string[] = [];
    const overflow = vi.fn();
    const read = lineReader((l) => lines.push(l), overflow, 8);
    read(Buffer.from('ok\n123456789'));
    read(Buffer.from('\nmore\n'));
    expect(lines).toEqual(['ok']);
    expect(overflow).toHaveBeenCalledOnce();
  });
});
