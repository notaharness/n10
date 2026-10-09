/**
 * The address of a persistent session, as its transport names it: the
 * session outlives any one connection to it, and this reaches it again
 * while it runs. Each transport adds its own variant; `kind` tells them
 * apart.
 */
export interface SessionTarget {
  kind: 'tmux';
  name: string;
}
