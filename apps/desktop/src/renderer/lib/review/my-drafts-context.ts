import { createContext, useContext } from 'react';
import type { DiffLine } from '@n10/diff';
import type { PullRequestRef } from '../../../host/contract.js';

/**
 * What a draft card in the diff needs from the diff around it: which
 * pull request it belongs to, which cards are open for editing, and the
 * file's current lines to tell whether the code under a draft changed.
 */
export interface MyDraftsScope {
  ref: PullRequestRef | null;
  editing: ReadonlySet<string>;
  setEditing: (key: string, on: boolean) => void;
  /** Forget a composer that never kept any text. */
  dropFresh: (key: string) => void;
  linesOf: (path: string) => readonly DiffLine[] | undefined;
}

export const MyDraftsContext = createContext<MyDraftsScope | null>(null);

export function useMyDrafts(): MyDraftsScope {
  const scope = useContext(MyDraftsContext);
  if (!scope) throw new Error('useMyDrafts needs a MyDraftsContext');
  return scope;
}
