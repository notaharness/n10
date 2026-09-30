import type { RefObject } from 'react';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import { TruncationBanner } from './ComparisonIdentity.js';
import { MovedBanner } from './MovedBanner.js';

/** What changed about the comparison since it was read, above the diff. */
export function PrDiffBanners({
  prDiff,
  shownFiles,
  comparisonRef,
}: {
  prDiff: PrDiffView;
  shownFiles: number;
  comparisonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <>
      {prDiff.moved && prDiff.comparison && (
        <MovedBanner
          moved={prDiff.moved}
          shownHead={prDiff.comparison.headOid}
          load={prDiff.loadMoved}
          focusAfter={comparisonRef}
        />
      )}
      {prDiff.truncated && (
        <TruncationBanner
          truncation={prDiff.truncated}
          shownFiles={shownFiles}
        />
      )}
    </>
  );
}
