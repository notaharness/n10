/**
 * The address of a persistent session, as its transport names it: the
 * session outlives any one connection to it, and this reaches it again
 * while it runs. Each transport adds its own variant; `kind` tells them
 * apart.
 */
export type SessionTarget = TmuxTarget | ManagedTarget;

/** A tmux session, addressed by its unique name on the server. */
export interface TmuxTarget {
  kind: 'tmux';
  name: string;
}

/**
 * A session held by a managed owner. `hostId` names that owner's
 * lifetime and `sessionId` the record within it: together they are its
 * identity. `name` is the record's label, unique within the owner while
 * the record exists and reused after it is removed, so it addresses a
 * session but never identifies one.
 */
export interface ManagedTarget {
  kind: 'mux';
  hostId: string;
  sessionId: string;
  name: string;
}

/** Whether two targets address the same session: a managed label alone
 *  never matches. */
export function sameSessionTarget(a: SessionTarget, b: SessionTarget): boolean {
  if (a.kind === 'tmux' || b.kind === 'tmux')
    return a.kind === b.kind && a.name === b.name;
  return a.hostId === b.hostId && a.sessionId === b.sessionId;
}
