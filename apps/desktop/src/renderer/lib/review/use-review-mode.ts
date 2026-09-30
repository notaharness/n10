import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { focusAfter } from '../focus.js';
import { useTabView } from '../tabs/tab-views.js';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
  adoptPullRequest,
  backTarget,
  backToReviewPane,
  initialMode,
  lastReviewPane,
  type PaneState,
  type ReviewPane,
} from './overview-model.js';
import { focusesAgent, type AgentPresence, type Mode } from './review-model.js';

/**
 * The terminal takes over the pane whenever an agent starts;
 * {@link focusesAgent} owns which changes count. A tab the user comes
 * back to is mounted afresh and opens on a working agent's terminal
 * through {@link initialMode}.
 *
 * Written as state adjusted during render (React's own pattern for
 * "derive from a prop change") rather than an effect, so the pane never
 * paints the diff for one frame before switching.
 */
function useAgentFocus(next: AgentPresence, onFocusAgent: () => void): void {
  const [prev, setPrev] = useState(next);
  if (prev.hasSession !== next.hasSession || prev.running !== next.running) {
    setPrev(next);
    if (focusesAgent(prev, next)) onFocusAgent();
  }
}

/**
 * The pane a review workspace shows. It opens where {@link initialMode}
 * says — the terminal while an agent runs, else a pull request's
 * Overview or a bare worktree's diff — and after that changes only when
 * the reader picks a pane, an agent takes it over, or the pull request
 * itself arrives before either has happened.
 */
export function useReviewMode({
  pr,
  agent,
}: {
  pr: PullRequestInfo | undefined;
  agent: AgentPresence;
}): [Mode, Dispatch<SetStateAction<Mode>>] {
  const hasPr = pr != null;
  const initial = () => initialMode({ running: agent.running, hasPr });
  // A tab the reader comes back to opens on the pane they picked
  // there. One they never picked follows the landing rule again, so an
  // agent started since shows, and one that has ended no longer does.
  const { saved, save } = useTabView();
  const [pane, setPane] = useState<PaneState>(() =>
    saved.pane?.chosen ? saved.pane : { mode: initial(), chosen: false, hasPr }
  );
  useEffect(() => save({ pane }), [pane, save]);
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
 * last on, or before either has shown, where the review starts.
 * Adjusted during render, like the pane itself.
 */
export function useLastReviewPane(
  mode: Mode,
  pr: PullRequestInfo | undefined
): ReviewPane {
  const [last, setLast] = useState<ReviewPane | null>(null);
  const next = lastReviewPane(last, mode);
  if (next !== last) setLast(next);
  return backToReviewPane(next, pr != null);
}

/**
 * The header's Back, up from the pane showing (`backTarget`). The
 * keyboard goes to where it leads: the changes, or the heading of what
 * the Overview shows (its own, or its check list's).
 */
export function useBackToReview({
  mode,
  pr,
  setMode,
  changes,
  root,
}: {
  mode: Mode;
  pr: PullRequestInfo | undefined;
  setMode: (mode: Mode) => void;
  changes: RefObject<HTMLElement | null>;
  root: RefObject<HTMLElement | null>;
}): () => void {
  const last = useLastReviewPane(mode, pr);
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
