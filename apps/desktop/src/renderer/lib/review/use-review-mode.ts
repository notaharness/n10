import {
  useCallback,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { focusAfter } from '../focus.js';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
  adoptPullRequest,
  backTarget,
  backToReviewPane,
  initialMode,
  lastReviewPane,
  reviewRole,
  type PaneState,
  type ReviewPane,
} from './overview-model.js';
import { focusesAgent, type AgentPresence, type Mode } from './review-model.js';

/**
 * The terminal takes over the pane whenever an agent starts, and
 * whenever the user comes back to a tab that already has one running —
 * the agent is what they returned for, not the diff. {@link focusesAgent}
 * owns which changes count as either.
 *
 * Written as state adjusted during render (React's own pattern for
 * "derive from a prop change") rather than an effect, so the pane never
 * paints the diff for one frame before switching.
 */
function useAgentFocus(next: AgentPresence, onFocusAgent: () => void): void {
  const [prev, setPrev] = useState(next);
  if (
    prev.hasSession !== next.hasSession ||
    prev.running !== next.running ||
    prev.active !== next.active
  ) {
    setPrev(next);
    if (focusesAgent(prev, next)) onFocusAgent();
  }
}

/**
 * The pane a review workspace shows. It opens where {@link initialMode}
 * says — the Overview for someone else's pull request, the diff for
 * your own, the terminal while an agent runs — and after that changes
 * only when the reader picks a pane, an agent takes it over, or the
 * pull request itself arrives before either has happened.
 */
export function useReviewMode({
  pr,
  viewer,
  agent,
}: {
  pr: PullRequestInfo | undefined;
  viewer: string | null;
  agent: AgentPresence;
}): [Mode, Dispatch<SetStateAction<Mode>>] {
  const hasPr = pr != null;
  const initial = () =>
    initialMode({
      running: agent.running,
      hasPr,
      role: pr ? reviewRole(pr, viewer) : 'author',
    });
  const [pane, setPane] = useState<PaneState>(() => ({
    mode: initial(),
    chosen: false,
    hasPr,
  }));
  if (pane.hasPr !== hasPr) setPane(adoptPullRequest(pane, hasPr, initial()));
  const setMode = useCallback((next: SetStateAction<Mode>) => {
    setPane((p) => ({
      ...p,
      mode: typeof next === 'function' ? next(p.mode) : next,
      chosen: true,
    }));
  }, []);
  useAgentFocus(agent, () => setMode('agent'));
  return [pane.mode, setMode];
}

/**
 * The review pane the terminal's Back returns to: the one the reader was
 * last on, or before either has shown, the one the pull request opens on
 * for this reader as the list reads now. Adjusted during render, like
 * the pane itself.
 */
export function useLastReviewPane(
  mode: Mode,
  pr: PullRequestInfo | undefined,
  viewer: string | null
): ReviewPane {
  const [last, setLast] = useState<ReviewPane | null>(null);
  const next = lastReviewPane(last, mode);
  if (next !== last) setLast(next);
  return backToReviewPane(next, pr ? reviewRole(pr, viewer) : 'author');
}

/**
 * The header's Back, up from the pane showing (`backTarget`). The
 * keyboard goes to where it leads: the changes, or the heading of what
 * the Overview shows (its own, or its check list's).
 */
export function useBackToReview({
  mode,
  pr,
  viewer,
  setMode,
  changes,
  root,
}: {
  mode: Mode;
  pr: PullRequestInfo | undefined;
  viewer: string | null;
  setMode: (mode: Mode) => void;
  changes: RefObject<HTMLElement | null>;
  root: RefObject<HTMLElement | null>;
}): () => void {
  const last = useLastReviewPane(mode, pr, viewer);
  const pane = backTarget(mode, last) ?? last;
  return () => {
    setMode(pane);
    focusAfter(() =>
      pane === 'diff'
        ? changes.current
        : root.current?.querySelector<HTMLElement>('[data-overview-heading]')
    );
  };
}
