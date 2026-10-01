import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core';
import { pullRequestKey } from '@n10/vcs-core/pr-details';
import { usePullRequestChecks } from '../../lib/data/pr-checks-query.js';
import { NO_REF, pullRequestRefFor } from '../../lib/data/pr-snapshot-query.js';
import { keys } from '../../lib/data/query-keys.js';
import { useReadState } from '../../lib/data/use-read-state.js';
import { useRepo } from '../../lib/repo-context.js';
import {
  nextStep,
  reviewRole,
  type AttentionAction,
} from '../../lib/review/overview-model.js';
import { GeneralComposer } from './overview/GeneralComposer.js';
import { PrActivity } from './overview/PrActivity.js';
import { PrAttention } from './overview/PrAttention.js';
import { PrChecks } from './overview/PrChecks.js';
import { PrDescription } from './overview/PrDescription.js';
import { PrIdentity } from './overview/PrIdentity.js';
import { PrReadiness } from './overview/PrReadiness.js';
import { PrReviewers } from './overview/PrReviewers.js';
import { cn } from '../../lib/utils.js';
import { PrActions } from './PrHeader.js';

/**
 * One column below 900 px of pane width — identity, next step,
 * reviewers, completion, then the description and the conversation —
 * and from there a reading column beside a context column: the
 * description and conversation run down the left while the reviewers
 * and completion stack on the right. The last row takes up whatever the
 * reading column needs, so the right column never spreads out to match.
 */
const LAYOUT =
  "mx-auto grid max-w-[1120px] gap-x-8 gap-y-6 px-6 py-6 [grid-template-areas:'head'_'next'_'people'_'ready'_'main'] @min-[900px]:grid-cols-[minmax(0,1fr)_260px] @min-[900px]:grid-rows-[auto_auto_auto_auto_1fr] @min-[900px]:[grid-template-areas:'head_head'_'next_next'_'main_people'_'main_ready'_'main_.']";

/**
 * The Overview or, nested in it, the check list; the list stays until
 * the reader goes Back, whatever a re-read brings, and Back returns to
 * where they were, scroll and keyboard both. Keyed by the pull request
 * so another one opens on its Overview.
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
  onOpenThread,
}: {
  pr: PullRequestInfo;
  onAction: (action: AttentionAction) => void;
  /** Show a remote thread in the diff, from the activity. */
  onOpenThread: (id: string, path: string | null) => void;
}) {
  const { repo } = useRepo();
  const role = reviewRole(pr, repo.viewer);
  const ref = pullRequestRefFor(repo, pr.id);
  // The head the list row names: a push reads the checks again.
  const head = pr.headSha ?? null;
  const checks = usePullRequestChecks(repo.cwd, ref, repo.viewer, pr);
  const {
    state: read,
    retrying,
    retry,
  } = useReadState(
    checks,
    keys.prChecks(repo.cwd, ref ?? NO_REF, repo.viewer, head)
  );
  const reading = checks.isPlaceholderData || checks.isFetching;
  const pane = useRef<HTMLDivElement>(null);
  const checksButton = useRef<HTMLButtonElement>(null);
  const nested = useNestedChecks(pr.id, pane, checksButton);

  return (
    <div ref={pane} className="@container relative h-full overflow-auto">
      {nested.showing && (
        <PrChecks
          read={read}
          head={head}
          reading={reading}
          retrying={retrying}
          onRetry={retry}
          onBack={nested.close}
          actions={<PrActions pr={pr} />}
        />
      )}
      {/* Kept mounted under the check list: the activity's filter,
          search, held updates and resolved threads stay as the reader
          left them. */}
      <div className={cn(LAYOUT, nested.showing && 'hidden')}>
        <PrIdentity
          pr={pr}
          actions={<PrActions pr={pr} />}
          className="[grid-area:head]"
        />
        <PrAttention
          step={nextStep(pr, role, repo.viewer)}
          onAction={onAction}
          className="[grid-area:next]"
        />
        <div className="[grid-area:people]">
          <PrReviewers
            reviewers={pr.reviewers ?? []}
            requirements={read.kind === 'ready' ? read.data.requirements : null}
            viewer={repo.viewer}
          />
        </div>
        <div className="[grid-area:ready]">
          <PrReadiness
            read={read}
            provider={repo.providerId}
            head={head}
            reading={reading}
            retrying={retrying}
            onRefresh={retry}
            onViewChecks={nested.open}
            checksRef={checksButton}
          />
        </div>
        <div className="min-w-0 [grid-area:main]">
          <PrDescription pr={pr} />
          {ref && (
            <>
              <PrActivity
                key={pullRequestKey(ref)}
                prRef={ref}
                onOpenThread={onOpenThread}
              />
              <div className="mt-6">
                <GeneralComposer key={pullRequestKey(ref)} prRef={ref} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
