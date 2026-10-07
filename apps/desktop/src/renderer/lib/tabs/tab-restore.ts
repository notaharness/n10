/** Identity tags that must agree before a saved tab can adopt a tmux target. */
const IDENTITY_TAGS = [
  '@orchestra-spawner',
  '@orchestra-repo',
  '@orchestra-session-type',
  '@orchestra-branch',
  '@orchestra-worktree-path',
  '@orchestra-agent',
];

export interface SavedTarget {
  tmuxName: string;
  tags: Record<string, string>;
  env?: Record<string, string>;
  conversationId?: string;
}

export function sameSavedTarget(a: SavedTarget, b: SavedTarget): boolean {
  return (
    a.tmuxName === b.tmuxName &&
    IDENTITY_TAGS.every((tag) => a.tags[tag] === b.tags[tag])
  );
}

/** A dead pane cannot be sampled; keep the last verified runtime facts. */
export function retainRuntime<T extends SavedTarget>(
  observed: T,
  previous: SavedTarget | undefined
): T & SavedTarget {
  if (!previous || !sameSavedTarget(previous, observed)) return observed;
  return {
    ...observed,
    env: observed.env ?? previous.env,
    conversationId: observed.conversationId ?? previous.conversationId,
  };
}
