import { repoDisplayName } from '../../lib/tabs/tab-presentation.js';
import type { Tab } from '../../lib/tabs/tabs.js';
import type { TabFace } from './use-strip-groups.js';

function distinctWorktree(tab: Extract<Tab, { kind: 'item' }>): string {
  if (!tab.worktree) return '';
  const directory = repoDisplayName(tab.worktree);
  const branch = tab.branch ?? '';
  return directory === branch.replaceAll('/', '-') ||
    directory === branch.split('/').at(-1)
    ? ''
    : directory;
}

function joinDistinct(parts: string[]): string {
  return parts
    .filter((part, at) => part && parts.indexOf(part) === at)
    .join(' · ');
}

export function rosterSecondary(face: TabFace): string {
  const { tab } = face;
  if (tab.kind === 'terminal')
    return joinDistinct([
      repoDisplayName(tab.repo ?? tab.cwd),
      repoDisplayName(tab.cwd),
      face.branch ?? '',
    ]);
  if (tab.kind === 'item')
    return joinDistinct([
      repoDisplayName(tab.repo),
      face.labelKind === 'pr' ? tab.itemKey.replace(/^pr:/, '#') : '',
      tab.branch ?? '',
      distinctWorktree(tab),
    ]);
  return '';
}
