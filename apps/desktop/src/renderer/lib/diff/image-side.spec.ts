import { BLOB_IMAGE_MAX_BYTES } from '@n10/core/ui';
import { describe, expect, it } from 'vitest';
import { imageSideView } from './image-side.js';

const OID = 'a'.repeat(40);

describe('a side of a changed image', () => {
  it('is absent where the change added or deleted the file', () => {
    expect(imageSideView(null, null)).toBe('absent');
  });

  it('is not asked for past the host’s ceiling', () => {
    expect(imageSideView(OID, BLOB_IMAGE_MAX_BYTES + 1)).toBe('too-large');
  });

  it('is read up to the ceiling, or when its size is not known', () => {
    expect(imageSideView(OID, BLOB_IMAGE_MAX_BYTES)).toBe('read');
    expect(imageSideView(OID, null)).toBe('read');
  });
});
