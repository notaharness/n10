import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import type { FileBody } from '../../../lib/diff/diff-bodies.js';

export interface FindCoverage {
  pending: number;
  fullRead: string[];
  failed: string[];
  unavailable: number;
  changesRead: string[];
  incompleteManifest: boolean;
}

function countBody(
  coverage: FindCoverage,
  path: string,
  body: FileBody | undefined
): void {
  if (!body || body.state === 'loading') coverage.pending++;
  else if (
    body.state === 'large' ||
    (body.state === 'loaded' && body.scope === 'changes')
  ) {
    coverage.fullRead.push(path);
  } else if (body.state === 'error') {
    coverage.failed.push(path);
  } else if (body.state === 'too-large') {
    coverage.unavailable++;
    if (body.scope === 'whole-file') coverage.changesRead.push(path);
  }
}

/** Search can count only file bodies in hand. Normal reads are requested
 * while find is open; large files still need an explicit full read. */
export function diffFindCoverage(prDiff: PrDiffView | undefined): FindCoverage {
  const coverage: FindCoverage = {
    pending: 0,
    fullRead: [],
    failed: [],
    unavailable: 0,
    changesRead: [],
    incompleteManifest: prDiff?.incomplete ?? false,
  };
  if (!prDiff) return coverage;
  for (const file of prDiff.manifestFiles) {
    countBody(coverage, file.path, prDiff.bodies.get(file.path));
  }
  return coverage;
}

export function coverageMessage(coverage: FindCoverage): string | null {
  const parts: string[] = [];
  if (coverage.pending)
    parts.push(
      `${coverage.pending} file${
        coverage.pending === 1 ? '' : 's'
      } still loading`
    );
  if (coverage.fullRead.length)
    parts.push(
      `${coverage.fullRead.length} file${
        coverage.fullRead.length === 1 ? '' : 's'
      } not fully loaded`
    );
  if (coverage.failed.length)
    parts.push(
      `${coverage.failed.length} file${
        coverage.failed.length === 1 ? '' : 's'
      } unavailable`
    );
  if (coverage.unavailable)
    parts.push(
      `${coverage.unavailable} file${
        coverage.unavailable === 1 ? '' : 's'
      } exceed the diff limit`
    );
  if (coverage.incompleteManifest) parts.push('file list incomplete');
  return parts.length ? `Results incomplete: ${parts.join('; ')}.` : null;
}
