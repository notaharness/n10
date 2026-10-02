/**
 * Pull request diffs read at exact commits: the renderer names the
 * pull request by its branches and the provider's head, the engine
 * resolves that to commits once, and every later read is by those
 * commits. The requests and results are the engine's
 * (`@n10/engine/contract`); these are the manifest's own types.
 *
 * Split from `contract.ts` because it is one subject, and because that
 * file is a catalogue already.
 */

export type {
  ManifestFileKind,
  PrComparison,
  PrComparisonError,
  PrComparisonErrorCode,
  PrDiffManifest,
  PrDiffManifestFile,
  PrDiffPatch,
} from '@n10/core';
