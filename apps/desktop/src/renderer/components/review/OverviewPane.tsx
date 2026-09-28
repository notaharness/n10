import type { PullRequestInfo } from '@n10/vcs-core';
import { useRepo } from '../../lib/repo-context.js';
import {
  nextStep,
  readiness,
  reviewRole,
  type AttentionAction,
} from '../../lib/review/overview-model.js';
import { PrAttention } from './overview/PrAttention.js';
import { PrDescription } from './overview/PrDescription.js';
import { PrIdentity } from './overview/PrIdentity.js';
import { PrReadiness } from './overview/PrReadiness.js';
import { PrReviewers } from './overview/PrReviewers.js';
import { VerdictActions } from './overview/VerdictActions.js';

/**
 * One column below 900 px of pane width — identity, next step,
 * readiness, description, people — and from there a reading column
 * beside a context column, the description running down the left while
 * readiness and reviewers stack on the right. The last row takes up
 * whatever the description needs, so the right column never spreads out
 * to match it.
 */
const LAYOUT =
  "mx-auto grid max-w-[1120px] gap-x-8 gap-y-6 px-6 py-6 [grid-template-areas:'head'_'next'_'ready'_'main'_'people'] @min-[900px]:grid-cols-[minmax(0,1fr)_260px] @min-[900px]:grid-rows-[auto_auto_auto_auto_1fr] @min-[900px]:[grid-template-areas:'head_head'_'next_next'_'main_ready'_'main_people'_'main_.']";

/**
 * The pull request Overview: what the change is and why, what the
 * reader should do next, what stands between it and completion, and
 * who has weighed in.
 */
export function OverviewPane({
  pr,
  onAction,
}: {
  pr: PullRequestInfo;
  onAction: (action: AttentionAction) => void;
}) {
  const { repo } = useRepo();
  const role = reviewRole(pr, repo.viewer);

  return (
    <div className="@container h-full overflow-auto">
      <div className={LAYOUT}>
        <PrIdentity pr={pr} className="[grid-area:head]" />
        <PrAttention
          step={nextStep(pr, role, repo.viewer)}
          onAction={onAction}
          className="[grid-area:next]"
        />
        <div className="[grid-area:ready]">
          <PrReadiness readiness={readiness(pr)} />
        </div>
        <PrDescription pr={pr} className="min-w-0 [grid-area:main]" />
        <div className="space-y-6 [grid-area:people]">
          <PrReviewers reviewers={pr.reviewers ?? []} viewer={repo.viewer} />
          {role === 'reviewer' && <VerdictActions prId={pr.id} />}
        </div>
      </div>
    </div>
  );
}
