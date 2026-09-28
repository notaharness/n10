import { ChevronRightIcon } from 'lucide-react';
import { useEffect, useRef, type Ref } from 'react';
import type {
  CheckList,
  PullRequestChecksAnswer,
  PullRequestReadiness,
} from '../../../../host/contract.js';
import type { ReadState } from '../../../lib/data/read-state.js';
import {
  ASPECT_LABEL,
  checksLabel,
  failureText,
  headline,
  RESOLVER_TEXT,
  shortOid,
} from '../../../lib/review/readiness-model.js';
import { relativeTime } from '../../../lib/utils.js';
import { Button } from '../../ui/button.js';
import { Skeleton } from '../../ui/skeleton.js';
import { ReadFailure, StaleNotice } from '../ReadNotice.js';
import { Section } from './parts.js';
import { HEADLINE_STATE, RefreshButton, StateIcon } from './ReadinessParts.js';

function Headline({
  readiness,
  provider,
  headlineRef,
}: {
  readiness: PullRequestReadiness;
  provider: string | null;
  headlineRef: Ref<HTMLDivElement>;
}) {
  const { text, detail } = headline(readiness, provider);
  const first = readiness.state === 'blocked' ? readiness.blockers[0] : null;
  const whole = HEADLINE_STATE[readiness.state];
  // Blocked by something under way reads as waiting, not as a failure.
  const [state, label] = first?.pending
    ? (['waiting', 'Waiting'] as const)
    : [whole.state, whole.label];
  return (
    <div
      ref={headlineRef}
      tabIndex={-1}
      // A new verdict after a refresh is announced where it is shown.
      aria-live="polite"
      aria-atomic
      data-readiness-headline={readiness.state}
      className="flex gap-2 outline-none"
    >
      <StateIcon state={state} label={label} className="mt-0.5 size-4" />
      <div className="min-w-0">
        <p className="font-medium">{text}</p>
        {first && (
          <p className="text-sm text-muted-foreground">
            {RESOLVER_TEXT[first.resolvedBy]}
          </p>
        )}
        {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
    </div>
  );
}

/** The blockers beneath the headline, each with who can clear it: the
 *  rest when blocked, and every one known where the verdict is not. */
function MoreBlockers({ readiness }: { readiness: PullRequestReadiness }) {
  const { state, blockers } = readiness;
  const shown =
    state === 'blocked'
      ? blockers.slice(1)
      : state === 'unknown'
      ? blockers
      : [];
  if (shown.length === 0) return null;
  return (
    <ul
      aria-label={state === 'blocked' ? 'Also blocking' : 'Known blockers'}
      className="mt-2 space-y-1 pl-6 text-sm"
    >
      {shown.map((b) => (
        <li key={`${b.kind}:${b.text}`} data-readiness-blocker={b.kind}>
          {b.text}
          <span className="text-muted-foreground">
            {' '}
            · {RESOLVER_TEXT[b.resolvedBy]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Aspects({ readiness }: { readiness: PullRequestReadiness }) {
  return (
    <ul className="mt-3 space-y-1.5 text-sm">
      {readiness.aspects.map((a) => (
        <li
          key={a.id}
          data-readiness-row={a.id}
          className="flex items-start gap-2"
        >
          <StateIcon
            state={a.state}
            severe={a.severe}
            className="mt-0.5 size-3.5"
          />
          <span className="w-24 shrink-0 text-muted-foreground">
            {ASPECT_LABEL[a.id]}
          </span>
          <span className="min-w-0 break-words">{a.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Which head the answer is about and when it was read, or why the
 *  checks were not read. */
function Provenance({
  answer,
  reading,
}: {
  answer: PullRequestChecksAnswer;
  reading: boolean;
}) {
  const { checks, fetchedAt } = answer;
  if (checks.state === 'failed') {
    return (
      <p role="status" className="mt-3 text-xs text-muted-foreground">
        The checks could not be read: {failureText(checks)}
      </p>
    );
  }
  if (checks.state !== 'read') return null;
  return (
    <p className="mt-3 text-xs text-muted-foreground" data-readiness-source>
      On <span className="font-mono">{shortOid(checks.value.head)}</span>
      {reading ? (
        <span className="text-warning">
          , before the latest push · reading again
        </span>
      ) : (
        <> · read {relativeTime(fetchedAt)}</>
      )}
    </p>
  );
}

export interface ReadinessProps {
  /** Core's readiness and check list, as far as they were read. */
  read: ReadState<PullRequestChecksAnswer>;
  provider: string | null;
  /** The answer on screen is the last head's while the new one reads. */
  reading: boolean;
  /** A refresh the reader asked for is under way. */
  retrying: boolean;
  onRefresh: () => void;
  onViewChecks: () => void;
  /** The View checks button, which Back returns the keyboard to. */
  checksRef?: Ref<HTMLButtonElement>;
}

function Actions({
  readiness,
  list,
  retrying,
  onRefresh,
  onViewChecks,
  checksRef,
}: {
  readiness: PullRequestReadiness;
  list: CheckList | null;
} & Pick<
  ReadinessProps,
  'retrying' | 'onRefresh' | 'onViewChecks' | 'checksRef'
>) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {list && (
        <Button
          ref={checksRef}
          variant="outline"
          size="sm"
          disabled={list.rows.length === 0}
          onClick={onViewChecks}
          className="h-auto min-h-8 whitespace-normal py-1 text-left"
        >
          {checksLabel(list)}
          <ChevronRightIcon />
        </Button>
      )}
      {readiness.state === 'unknown' && (
        <RefreshButton retrying={retrying} onRefresh={onRefresh} />
      )}
    </div>
  );
}

/**
 * Refresh goes once the verdict is known; the keyboard moves to the
 * verdict it brought rather than falling to the page.
 */
function useRefocusAfterRefresh(showsRefresh: boolean, onRefresh: () => void) {
  const headlineRef = useRef<HTMLDivElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (showsRefresh || !refocus.current) return;
    refocus.current = false;
    headlineRef.current?.focus();
  }, [showsRefresh]);
  const refresh = () => {
    refocus.current = true;
    onRefresh();
  };
  return { headlineRef, refresh };
}

/**
 * What stands between the pull request and completion, as core decided
 * it: the verdict in one sentence with who can act, then one row per
 * fact. It is never "ready" unless the provider says so; where not
 * everything was read it says so, with Refresh.
 */
export function PrReadiness(props: ReadinessProps) {
  const { read, provider, reading, retrying, onRefresh } = props;
  const data = read.kind === 'ready' ? read.data : null;
  const { headlineRef, refresh } = useRefocusAfterRefresh(
    data?.readiness.state === 'unknown',
    onRefresh
  );
  return (
    <Section title="Completion">
      {read.kind === 'failed' ? (
        <ReadFailure
          title="Couldn't read what completion needs"
          error={read.error}
          retrying={retrying}
          onRetry={onRefresh}
          stacked
        />
      ) : !data || read.kind !== 'ready' ? (
        <div aria-busy className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-36" />
        </div>
      ) : (
        <>
          {read.stale && (
            <StaleNotice
              what="completion"
              stale={read.stale}
              retrying={retrying}
              onRetry={onRefresh}
              stacked
              className="mb-2"
            />
          )}
          <Headline
            readiness={data.readiness}
            provider={provider}
            headlineRef={headlineRef}
          />
          <MoreBlockers readiness={data.readiness} />
          <Aspects readiness={data.readiness} />
          <Actions
            {...props}
            onRefresh={refresh}
            readiness={data.readiness}
            list={data.list}
          />
          <Provenance answer={data} reading={reading} />
        </>
      )}
    </Section>
  );
}
