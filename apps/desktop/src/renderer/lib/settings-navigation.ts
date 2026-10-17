import { useSyncExternalStore } from 'react';
import type { GroupKey } from './settings-groups.js';

let snapshot = { section: 'updates' as GroupKey, revision: 0 };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getSnapshot = () => snapshot;
export function selectSettingsSection(section: GroupKey) {
  snapshot = { section, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener();
}
export function useSettingsNavigation() {
  return useSyncExternalStore(subscribe, getSnapshot);
}
