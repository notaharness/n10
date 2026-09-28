import type {
  CheckOutcome,
  CheckRequirement,
  PullRequestCheck,
  ReadOutcome,
} from '@n10/vcs-core';
import type {
  CheckList,
  PullRequestReadiness,
  ReadinessAspect,
  Resolver,
} from '../../../host/contract.js';

/**
 * The words the Completion section and the check list use. Every
 * decision — what blocks, what waits, what a check's standing is — is
 * core's (`pr-readiness.ts`, `pr-check-list.ts`); this file only says
 * it, so the two frontends can word the same facts their own way.
 */

export const ASPECT_LABEL: Record<ReadinessAspect['id'], string> = {
  lifecycle: 'State',
  reviews: 'Reviews',
  checks: 'Checks',
  conflicts: 'Conflicts',
  conversations: 'Conversations',
};

/** Who can clear a blocker, said as what happens next. */
export const RESOLVER_TEXT: Record<Resolver, string> = {
  author: 'The author can fix this',
  reviewers: 'Needs a reviewer',
  maintainers: 'Needs a maintainer',
  checks: 'Clears when the checks finish',
};

/** GitHub merges; Azure DevOps completes. */
function verb(provider: string | null): string {
  return provider === 'azure-devops' ? 'complete' : 'merge';
}

export interface Headline {
  text: string;
  /** Beneath it: how much more there is, or why it is not known. */
  detail: string | null;
}

/** One sentence for the whole: the strongest blocker when blocked,
 *  and never "ready" unless core says so. */
export function headline(
  readiness: PullRequestReadiness,
  provider: string | null
): Headline {
  const { state, blockers, unknowns } = readiness;
  if (state === 'merged') return { text: 'Merged', detail: null };
  if (state === 'closed') return { text: 'Closed', detail: null };
  if (state === 'ready') {
    return { text: `Ready to ${verb(provider)}`, detail: null };
  }
  // The rest of the blockers are listed right beneath it.
  if (state === 'blocked' && blockers[0]) {
    return { text: blockers[0].text, detail: null };
  }
  return {
    text: 'Readiness not fully known',
    detail:
      unknowns.length > 0
        ? `Not known: ${unknowns.map(lowerFirst).join(', ')}`
        : null,
  };
}

/** Core's unknowns are sentence case; after "Not known:" they run on. */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** A failed read in the provider's words, with when to try again where
 *  it said: a time of day, which stays true while it is on screen. */
export function failureText(
  failure: Extract<ReadOutcome<unknown>, { state: 'failed' }>,
  now = Date.now()
): string {
  const ms = failure.retryAfterMs;
  if (ms == null) return failure.reason;
  const at = new Date(now + ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `${failure.reason} (try again after ${at})`;
}

/** What the answer on screen is while a newer one reads: the last
 *  head's after a push, or this head's being read again. */
export function readingNote(
  answerHead: string | null,
  head: string | null,
  reading: boolean
): string | null {
  if (!reading) return null;
  return answerHead != null && head != null && answerHead !== head
    ? 'before the latest push · reading again'
    : 'reading again';
}

/** "View checks": how many passed of how many, how many reported on an
 *  older push, and where not all were read, how many were. */
export function checksLabel(list: CheckList): string {
  const shown = list.rows.length;
  if (shown === 0) {
    return list.complete ? 'No checks reported' : 'Checks not all read';
  }
  const parts = [`${list.count.passed} of ${shown} passed`];
  if (list.stale > 0) parts.push(`${list.stale} on an older revision`);
  if (!list.complete) {
    parts.push(
      list.total != null ? `${shown} of ${list.total} read` : 'not all read'
    );
  }
  return `View checks · ${parts.join(' · ')}`;
}

export const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  queued: 'Queued',
  waiting: 'Waiting',
  running: 'Running',
  succeeded: 'Passed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  neutral: 'Neutral',
  expected: 'Expected',
  unknown: 'Unknown',
};

export const REQUIREMENT_LABEL: Record<CheckRequirement, string> = {
  required: 'Required',
  optional: 'Optional',
  unknown: 'Not known if required',
};

/** An outcome n10 has no word for keeps the provider's. */
export function outcomeText(check: PullRequestCheck): string {
  if (check.manual) return 'Not started';
  return check.outcome === 'unknown' && check.native
    ? check.native
    : OUTCOME_LABEL[check.outcome];
}

/** How long it ran, where both ends are known: `2m 31s`, `48s`. */
export function duration(check: PullRequestCheck): string | null {
  if (!check.startedAt || !check.completedAt) return null;
  const ms = Date.parse(check.completedAt) - Date.parse(check.startedAt);
  if (!Number.isFinite(ms) || ms < 0) return null;
  const secs = Math.round(ms / 1000);
  const mins = Math.floor(secs / 60);
  if (mins === 0) return `${secs}s`;
  const hours = Math.floor(mins / 60);
  if (hours === 0) return `${mins}m ${secs % 60}s`;
  return `${hours}h ${mins % 60}m`;
}

export function shortOid(oid: string): string {
  return oid.slice(0, 7);
}

/** What a check waits for, where that is a person. */
export function waitsFor(check: PullRequestCheck): string | null {
  return check.manual ? 'Someone must start it' : null;
}

/** Where an expected check must come from, in words. */
export function requiredFrom(check: PullRequestCheck): string | null {
  const app = check.requires?.app;
  if (!app) return null;
  return app.slug
    ? `Must come from ${app.slug}`
    : `Must come from app ${app.id}`;
}
