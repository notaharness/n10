import { crc32, deflateSync } from 'node:zlib';

/**
 * A PNG made in the test, so a diff can hold real image bytes without
 * fixtures on disk: `pixel` gives each pixel's RGBA.
 */

type Rgba = [number, number, number, number];

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function png(
  width: number,
  height: number,
  pixel: (x: number, y: number) => Rgba
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows: number[] = [];
  for (let y = 0; y < height; y++) {
    rows.push(0); // no filter
    for (let x = 0; x < width; x++) rows.push(...pixel(x, y));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A filled disc on a transparent ground. */
export function disc(size: number, color: Rgba): Buffer {
  const r = size / 2;
  return png(size, size, (x, y) =>
    (x + 0.5 - r) ** 2 + (y + 0.5 - r) ** 2 <= r * r ? color : [0, 0, 0, 0]
  );
}

/** A rectangle filled with a horizontal gradient between two colours. */
export function gradient(
  width: number,
  height: number,
  from: Rgba,
  to: Rgba
): Buffer {
  return png(width, height, (x) => {
    const t = width > 1 ? x / (width - 1) : 0;
    return from.map((c, i) => Math.round(c + (to[i]! - c) * t)) as Rgba;
  });
}
