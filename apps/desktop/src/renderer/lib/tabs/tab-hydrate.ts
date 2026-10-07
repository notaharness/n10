import type { TabsState } from './tabs-model.js';

/** A persisted tab waits for discovery or an explicit resume request. */
export function hydrateTabs(saved: TabsState): TabsState {
  return {
    ...saved,
    tabs: saved.tabs.map((tab) =>
      tab.kind === 'terminal'
        ? { ...tab, resumeRequired: true }
        : tab.kind === 'item' && tab.restore && tab.sessionName
        ? { ...tab, resumeRequired: true }
        : tab
    ),
  };
}
