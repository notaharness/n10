import { useState } from 'react';
import type { Mode } from './review-model.js';
import { usePaneShown } from '../tabs/pane-shown.js';

/**
 * Whether the diff is in front of the reader, as of the pane last
 * resolved: a visit counts only once it has been, and not while this
 * is the hidden spare pane, rendered ahead of a switch. `settle` takes
 * the pane resolved this render; the next one reads it.
 */
export function useDiffShown() {
  const [shown, setShown] = useState(false);
  const paneShown = usePaneShown();
  return {
    shown,
    settle(mode: Mode) {
      const now = paneShown && mode === 'diff';
      if (now !== shown) setShown(now);
    },
  };
}
