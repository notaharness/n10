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
