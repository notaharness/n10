import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBlobImage, sniffImageType } from './blob-image.js';

/** A blob's bytes read from real git, and what they are taken for. */

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

let repo: string;
const store = (bytes: Buffer) =>
  execFileSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: repo,
    input: bytes,
    encoding: 'utf8',
  }).trim();

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'n10-blob-image-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe('readBlobImage', () => {
  it('reads a blob whole, as a data URL of the type its bytes name', async () => {
    // Bytes past the first non-UTF-8 one must survive the read.
    const bytes = Buffer.concat([PNG, Buffer.from([0xff, 0xfe, 0x00, 0x80])]);
    const result = await readBlobImage(repo, store(bytes));
    expect(result).toEqual({
      ok: true,
      image: {
        dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        contentType: 'image/png',
        bytes: bytes.length,
      },
    });
  });

  it('refuses bytes that are not an image it knows', async () => {
    const result = await readBlobImage(repo, store(Buffer.from('<svg/>\n')));
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'not-an-image' },
    });
  });

  it('stops at the ceiling and says the image is too large', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(4096)]);
    const result = await readBlobImage(repo, store(big), 1024);
    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } });
  });

  it('refuses anything but an object id', async () => {
    await expect(readBlobImage(repo, 'HEAD:README.md')).rejects.toThrow(
      'Not an object id'
    );
  });

  it('fails for a blob the clone does not have', async () => {
    await expect(readBlobImage(repo, 'e'.repeat(40))).rejects.toThrow(
      /git cat-file failed/
    );
  });
});

describe('sniffImageType', () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  it.each([
    ['image/png', bytes(0x89, 0x50, 0x4e, 0x47)],
    ['image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0)],
    ['image/gif', bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)],
    [
      'image/webp',
      bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50),
    ],
    ['image/bmp', bytes(0x42, 0x4d, 0, 0)],
    ['image/x-icon', bytes(0, 0, 1, 0, 1, 0)],
  ])('knows %s by its leading bytes', (type, b) => {
    expect(sniffImageType(b)).toBe(type);
  });

  it('takes a RIFF file that is not WebP for nothing', () => {
    expect(
      sniffImageType(
        bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)
      )
    ).toBeNull();
  });

  it('takes too few bytes for nothing', () => {
    expect(sniffImageType(bytes(0x89, 0x50))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});
