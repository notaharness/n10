/**
 * Past this, a side of a changed image is not read: it would cross IPC
 * as a data URL. Apart from `blob-image.ts` so the renderer, which does
 * not ask for a side this large, reads the same number (`@n10/core/ui`).
 */
export const BLOB_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
