import { useState, type Dispatch, type SetStateAction } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import { initialMode, reviewRole } from './overview-model.js';
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
 * only when the reader picks a pane or an agent takes it over.
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
  const [mode, setMode] = useState<Mode>(() =>
    initialMode({
      running: agent.running,
      hasPr: pr != null,
      role: pr ? reviewRole(pr, viewer) : 'author',
    })
  );
  useAgentFocus(agent, () => setMode('agent'));
  return [mode, setMode];
}
