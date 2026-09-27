import type { PullRequestInfo } from '@n10/vcs-core';
import { usePrDescription } from '../../lib/data/queries.js';
import type { ReadState } from '../../lib/data/read-state.js';
import { keys } from '../../lib/data/query-keys.js';
import { useReadState } from '../../lib/data/use-read-state.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  nextStep,
  readiness,
  reviewRole,
  type AttentionAction,
} from '../../lib/review/overview-model.js';
import { Skeleton } from '../ui/skeleton.js';
import { CommentMarkdown } from './comments/CommentMarkdown.js';
import { Section } from './overview/parts.js';
import { PrAttention } from './overview/PrAttention.js';
import { PrIdentity } from './overview/PrIdentity.js';
import { PrReadiness } from './overview/PrReadiness.js';
import { PrReviewers } from './overview/PrReviewers.js';
import { VerdictActions } from './overview/VerdictActions.js';
import { ReadFailure, StaleNotice } from './ReadNotice.js';

/**
 * The author's description. An empty body and a failed fetch are
 * different facts: only the first is "no description".
 */
function Description({
  state,
  retrying,
  onRetry,
}: {
  state: ReadState<string>;
  retrying: boolean;
  onRetry: () => void;
}) {
  if (state.kind === 'loading') {
    return (
      <div className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (state.kind === 'failed') {
    return (
      <ReadFailure
        title="Couldn't load the description"
        error={state.error}
        retrying={retrying}
        onRetry={onRetry}
      />
    );
  }
  return (
    <>
      {state.stale && (
        <StaleNotice
          what="description"
          stale={state.stale}
          retrying={retrying}
          onRetry={onRetry}
          className="mb-3"
        />
      )}
      {state.data ? (
        <CommentMarkdown markdown={state.data} />
      ) : (
        <p className="text-sm text-muted-foreground">
          This pull request has no description.
        </p>
      )}
    </>
  );
}

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
  const description = useReadState(
    usePrDescription(repo.cwd, pr.id),
    keys.prDescription(repo.cwd, pr.id)
  );

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
        <Section title="Description" className="min-w-0 [grid-area:main]">
          <Description
            state={description.state}
            retrying={description.retrying}
            onRetry={description.retry}
          />
        </Section>
        <div className="space-y-6 [grid-area:people]">
          <PrReviewers reviewers={pr.reviewers ?? []} viewer={repo.viewer} />
          {role === 'reviewer' && <VerdictActions prId={pr.id} />}
        </div>
      </div>
    </div>
  );
}
