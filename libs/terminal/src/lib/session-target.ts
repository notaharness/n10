/**
 * The persistent session a terminal connection addresses, as its
 * transport names it. A saved tab keeps this to reattach while the
 * session still runs, apart from the recipe that launches it again.
 * Each transport adds its own variant; `kind` tells them apart.
 */
export interface SessionTarget {
  kind: 'tmux';
  name: string;
}
