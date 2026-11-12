import type { SidebarItem } from '../../../host/contract.js';
import type { Tab } from '../../lib/tabs/tabs.js';

export function canShowTask(
  tab: Tab,
  item: SidebarItem | undefined,
  harness?: string
): boolean {
  if (tab.kind === 'terminal') return tab.terminalKind === 'agent';
  return (
    !!harness ||
    (tab.kind === 'item' && item?.kind === 'session' && !!item.session.running)
  );
}

export function bucketTabs<T>(
  tabs: readonly T[],
  keyOf: (tab: T) => string
): Map<string, T[]> {
  const buckets = new Map<string, T[]>();
  for (const tab of tabs) {
    const key = keyOf(tab);
    const bucket = buckets.get(key) ?? [];
    bucket.push(tab);
    buckets.set(key, bucket);
  }
  return buckets;
}
