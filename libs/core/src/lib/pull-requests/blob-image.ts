import { isOid } from '@n10/vcs-core';
import { runGitBytes } from '../utils/git-run.js';
import { BLOB_IMAGE_MAX_BYTES } from './blob-image-limit.js';

export { BLOB_IMAGE_MAX_BYTES };

/**
 * One side of a changed image, read from the repository by blob id, so
 * the diff can show the picture git has no lines for.
 *
 * A blob id names its bytes forever: a read never goes stale. What the
 * bytes are is decided by their own leading bytes, not by the file's
 * name, so a renamed or misnamed file is shown as what it is, and
 * anything that is not a raster image the renderer can draw is refused.
 */

/** Leading bytes that identify a format, as `[offset, byte]` pairs. */
const IMAGE_MAGIC: { type: string; signature: [number, number][] }[] = [
  {
    type: 'image/png',
    signature: [
      [0, 0x89],
      [1, 0x50],
      [2, 0x4e],
      [3, 0x47],
    ],
  },
  {
    type: 'image/jpeg',
    signature: [
      [0, 0xff],
      [1, 0xd8],
      [2, 0xff],
    ],
  },
  {
    type: 'image/gif',
    signature: [
      [0, 0x47],
      [1, 0x49],
      [2, 0x46],
      [3, 0x38],
    ],
  },
  {
    // "RIFF", four bytes of length, then "WEBP".
    type: 'image/webp',
    signature: [
      [0, 0x52],
      [1, 0x49],
      [2, 0x46],
      [3, 0x46],
      [8, 0x57],
      [9, 0x45],
      [10, 0x42],
      [11, 0x50],
    ],
  },
  {
    type: 'image/bmp',
    signature: [
      [0, 0x42],
      [1, 0x4d],
    ],
  },
  {
    type: 'image/x-icon',
    signature: [
      [0, 0x00],
      [1, 0x00],
      [2, 0x01],
      [3, 0x00],
    ],
  },
];

/** The image format the bytes begin with, or null for anything else. */
export function sniffImageType(bytes: Uint8Array): string | null {
  const match = IMAGE_MAGIC.find(({ signature }) =>
    signature.every(([offset, byte]) => bytes[offset] === byte)
  );
  return match?.type ?? null;
}

export interface BlobImage {
  dataUrl: string;
  contentType: string;
  bytes: number;
}

export interface BlobImageError {
  code: 'too-large' | 'not-an-image';
  message: string;
}

export type BlobImageResult =
  | { ok: true; image: BlobImage }
  | { ok: false; error: BlobImageError };

/**
 * The blob `oid` as an image. Too large or not an image is data; a blob
 * the clone does not have is git's failure, thrown.
 */
export async function readBlobImage(
  cwd: string,
  oid: string,
  maxBytes = BLOB_IMAGE_MAX_BYTES
): Promise<BlobImageResult> {
  if (!isOid(oid)) throw new Error(`Not an object id: ${oid}`);
  const { bytes, truncated } = await runGitBytes(['cat-file', 'blob', oid], {
    cwd,
    maxBytes,
  });
  if (truncated) {
    return {
      ok: false,
      error: {
        code: 'too-large',
        message: `larger than ${Math.round(maxBytes / (1024 * 1024))} MB`,
      },
    };
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return {
      ok: false,
      error: { code: 'not-an-image', message: 'not an image format n10 shows' },
    };
  }
  return {
    ok: true,
    image: {
      dataUrl: `data:${contentType};base64,${bytes.toString('base64')}`,
      contentType,
      bytes: bytes.length,
    },
  };
}
