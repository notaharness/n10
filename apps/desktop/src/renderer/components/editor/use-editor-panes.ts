import { useDeferredValue, useState } from 'react';
import {
  NOTHING_SHOWN,
  panesFor,
  shownIdFor,
  spareFor,
  type Shown,
} from '../../lib/tabs/editor-panes.js';
import { usePrewarm } from '../../lib/tabs/prewarm.js';
import type { Tab } from '../../lib/tabs/tabs.js';

/**
 * Which panes the editor renders: the one on screen, and the spare
 * (see `EditorArea`). The tab strip follows the live tabs so clicks
 * feel instant; a pane that has to mount follows a *deferred* copy, so
 * mounting runs as an interruptible background render instead of
 * blocking the click. A pane already rendered as the spare is shown at
 * once: there is nothing to defer.
 */
export function useEditorPanes(tabs: readonly Tab[], activeId: string | null) {
  const paneTabs = useDeferredValue(tabs);
  const paneActiveId = useDeferredValue(activeId);
  const prewarm = usePrewarm();
  const [shown, setShown] = useState<Shown>(NOTHING_SHOWN);
  const spare = spareFor(shown, prewarm, tabs);
  const shownId = shownIdFor({
    activeId,
    deferredId: paneActiveId,
    spare,
    shown: shown.tab,
  });
  const live = shownId === activeId;
  const activePane = (live ? tabs : paneTabs).find((t) => t.id === shownId);
  if ((activePane?.id ?? null) !== (shown.tab?.id ?? null)) {
    setShown({ tab: activePane ?? null, left: shown.tab, seq: prewarm.seq });
  }
  return {
    activePane,
    paneActiveId: shownId,
    panes: panesFor(activePane, spare),
  };
}
