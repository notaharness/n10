/** Pure review presentation geometry, separate from finding persistence. */
export {
  interleaveComments,
  getCommentPositions,
} from './lib/comment-renderer.js';
export { buildRowMap } from './lib/comment-rows.js';
export type { CommentImageLayouts } from './lib/comment-images.js';
export type { RemotePlacementDiagnostic } from './lib/comment-placement.js';
