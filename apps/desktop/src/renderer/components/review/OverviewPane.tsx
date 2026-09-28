import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core';
import { usePullRequestChecks } from '../../lib/data/pr-checks-query.js';
import { pullRequestRefFor } from '../../lib/data/pr-snapshot-query.js';
import { readState } from '../../lib/data/read-state.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  nextStep,
  reviewRole,
  type AttentionAction,
} from '../../lib/review/overview-model.js';
import { PrAttention } from './overview/PrAttention.js';
import { PrChecks } from './overview/PrChecks.js';
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
 * The Overview or, nested in it, the check list; Back from the list
 * returns to where the reader was, scroll and keyboard both. Keyed by
 * the pull request so another one opens on its Overview.
 */
function useNestedChecks(
  prId: number,
  pane: RefObject<HTMLDivElement | null>,
  checksButton: RefObject<HTMLButtonElement | null>
) {
  const [view, setView] = useState({ prId, checks: false });
  const top = useRef<number | null>(null);
  const showing = view.prId === prId && view.checks;
  useLayoutEffect(() => {
    if (showing || top.current == null || !pane.current) return;
    pane.current.scrollTo({ top: top.current });
    checksButton.current?.focus({ preventScroll: true });
    top.current = null;
  }, [showing, pane, checksButton]);
  return {
    showing,
    open: () => {
      top.current = pane.current?.scrollTop ?? 0;
      setView({ prId, checks: true });
      pane.current?.scrollTo({ top: 0 });
    },
    close: () => setView({ prId, checks: false }),
  };
}

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
  const ref = pullRequestRefFor(repo, pr.id);
  const checks = usePullRequestChecks(repo.cwd, ref, repo.viewer);
  const read = readState(checks);
  const pane = useRef<HTMLDivElement>(null);
  const checksButton = useRef<HTMLButtonElement>(null);
  const nested = useNestedChecks(pr.id, pane, checksButton);
  const refresh = () => void checks.refetch();

  return (
    <div ref={pane} className="@container h-full overflow-auto">
      {nested.showing && read.kind === 'ready' && read.data.list ? (
        <PrChecks
          list={read.data.list}
          head={
            read.data.checks.state === 'read'
              ? read.data.checks.value.head
              : null
          }
          fetchedAt={read.data.fetchedAt}
          onBack={nested.close}
        />
      ) : (
        <div className={LAYOUT}>
          <PrIdentity pr={pr} className="[grid-area:head]" />
          <PrAttention
            step={nextStep(pr, role, repo.viewer)}
            onAction={onAction}
            className="[grid-area:next]"
          />
          <div className="[grid-area:ready]">
            <PrReadiness
              read={read}
              provider={repo.providerId}
              refreshing={checks.isFetching}
              onRefresh={refresh}
              onViewChecks={nested.open}
              checksRef={checksButton}
            />
          </div>
          <PrDescription pr={pr} className="min-w-0 [grid-area:main]" />
          <div className="space-y-6 [grid-area:people]">
            <PrReviewers reviewers={pr.reviewers ?? []} viewer={repo.viewer} />
            {role === 'reviewer' && <VerdictActions prId={pr.id} />}
          </div>
        </div>
      )}
    </div>
  );
}
