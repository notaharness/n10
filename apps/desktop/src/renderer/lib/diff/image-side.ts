import { BLOB_IMAGE_MAX_BYTES } from '@n10/core/ui';

/**
 * What one side of a changed image shows before anything is read:
 * nothing, when the change added or deleted the file; a refusal, when
 * the manifest already says the host would not read it; else its read.
 */
export type ImageSideView = 'absent' | 'too-large' | 'read';

export function imageSideView(
  oid: string | null,
  bytes: number | null
): ImageSideView {
  if (oid === null) return 'absent';
  if (bytes !== null && bytes > BLOB_IMAGE_MAX_BYTES) return 'too-large';
  return 'read';
}

/** One side of a changed image, as the manifest describes it. */
export interface ImageSide {
  key: 'before' | 'after';
  label: 'Before' | 'After';
  path: string;
  oid: string | null;
  bytes: number | null;
  /** Why there is no side to show: the file was added or deleted. */
  absent: string;
}

export function imageSidesOf(file: {
  path: string;
  oldPath: string;
  oldOid: string | null;
  newOid: string | null;
  oldSize: number | null;
  newSize: number | null;
}): [ImageSide, ImageSide] {
  return [
    {
      key: 'before',
      label: 'Before',
      path: file.oldPath,
      oid: file.oldOid,
      bytes: file.oldSize,
      absent: 'Added in this change.',
    },
    {
      key: 'after',
      label: 'After',
      path: file.path,
      oid: file.newOid,
      bytes: file.newSize,
      absent: 'Deleted in this change.',
    },
  ];
}
