export type {
  DiffLine,
  FileDiff,
  DiffFile,
  DiffChangeStatus,
  FileCategory,
  ParsedDiffFile,
} from './lib/types.js';
export { parseDiffFiles, parseUnifiedDiff } from './lib/diff-parser.js';
export { unquoteGitPath } from './lib/git-path.js';
export { renderDiffLines } from './lib/diff-renderer.js';
export {
  classifyFile,
  partitionFiles,
  getDisplayFiles,
} from './lib/file-classifier.js';
