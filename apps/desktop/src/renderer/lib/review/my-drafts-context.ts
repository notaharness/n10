import { createContext, useContext } from 'react';
import type { DiffLine } from '@n10/diff';
import type { PullRequestRef } from '../../../host/contract.js';
import type { InlineTarget } from './my-drafts.js';

/**
 * What a draft card in the diff needs from the diff around it: which
 * pull request it belongs to, which cards are open for editing, the
 * file's current lines to tell whether the code under a draft changed,
 * and where the keyboard goes inside this list when a card closes.
 */
export interface MyDraftsScope {
  ref: PullRequestRef | null;
  editing: ReadonlySet<string>;
  setEditing: (key: string, on: boolean) => void;
  /** True once for a composer just opened: it takes the keyboard when
   *  it first mounts, not every time scrolling mounts it again. */
  takeFocus: (key: string) => boolean;
  /** Forget a composer that never kept any text. */
  dropFresh: (key: string) => void;
  /** Show a draft again at once, before its save lands (Undo). */
  restore: (target: InlineTarget) => void;
  linesOf: (path: string) => readonly DiffLine[] | undefined;
  /** Focus, in this list, the line or file a draft was about. */
  focusAnchor: (target: InlineTarget) => void;
  /** Focus a draft's card in this list, once it renders, unless the
   *  keyboard is somewhere already. */
  focusDraft: (key: string) => void;
}

export const MyDraftsContext = createContext<MyDraftsScope | null>(null);

export function useMyDrafts(): MyDraftsScope {
  const scope = useContext(MyDraftsContext);
  if (!scope) throw new Error('useMyDrafts needs a MyDraftsContext');
  return scope;
}
