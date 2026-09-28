import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import {
  adoptPullRequest,
  initialMode,
  lastReviewPane,
  reviewPaneFor,
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
 * The review pane the reader was last on, which the terminal's Back
 * returns to. Before either has shown, the one the pull request opens on
 * for this reader. Adjusted during render, like the pane itself.
 */
export function useLastReviewPane(
  mode: Mode,
  pr: PullRequestInfo | undefined,
  viewer: string | null
): ReviewPane {
  const [last, setLast] = useState<ReviewPane>(() =>
    reviewPaneFor(pr ? reviewRole(pr, viewer) : 'author')
  );
  const next = lastReviewPane(last, mode);
  if (next !== last) setLast(next);
  return next;
}
