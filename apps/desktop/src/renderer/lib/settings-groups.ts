import type { SettingsFieldView, SettingsGroup } from '../../host/contract.js';

/**
 * A settings section. `'appearance'` is desktop-local — it has no
 * host-side fields, because the theme and the window frame are
 * properties of this shell rather than of the repository. `'machines'`
 * is desktop-local too, in the same sense: it belongs to this app
 * instance, not to whichever repository happens to be open. `'keyboard'`
 * is drawn here as well: its shortcuts and the recently-used switch are
 * n10-wide (the global config and desktop prefs), not the repository's.
 */
export type GroupKey = 'appearance' | 'keyboard' | 'machines' | SettingsGroup;

export interface SettingsGroupMeta {
  key: GroupKey;
  label: string;
  blurb: string;
}

/** Section order on the page, and in the jump nav beside it. */
export const GROUPS: SettingsGroupMeta[] = [
  { key: 'appearance', label: 'Appearance', blurb: 'How n10 Desktop looks.' },
  {
    key: 'keyboard',
    label: 'Keyboard',
    blurb: 'Shortcuts for switching tabs, for every repository.',
  },
  {
    key: 'general',
    label: 'General',
    blurb: 'Editor, identity and worktree placement.',
  },
  {
    key: 'agent',
    label: 'Agent',
    blurb: 'Which AI coding agent n10 launches.',
  },
  {
    key: 'sync',
    label: 'Sync',
    blurb: 'Keeping worktrees in step with merged pull requests.',
  },
  {
    key: 'terminal',
    label: 'Terminal',
    blurb: 'How agent sessions are hosted.',
  },
  {
    key: 'provider',
    label: 'Provider',
    blurb: 'Credentials and project for your VCS host.',
  },
  {
    key: 'machines',
    label: 'Machines',
    blurb: 'Other machines in your fleet.',
  },
];

/** Sections this shell draws itself, shown whatever the host sends. */
const LOCAL_GROUPS = new Set<GroupKey>(['appearance', 'keyboard', 'machines']);

export interface SettingsSection extends SettingsGroupMeta {
  fields: SettingsFieldView[];
}

/**
 * Fold the host's flat field catalog into the sections the page renders.
 *
 * Sections keep `GROUPS` order rather than the order fields arrive in,
 * so the jump nav and the page agree however the host chooses to list
 * them. A section the host sent no fields for is dropped — an empty
 * card is a worse answer than no card — except Appearance, which is
 * always shown because its rows are this shell's own and never arrive
 * from the host at all. A field naming a section this build does not
 * know is ignored, so a newer host cannot render an unlabelled card.
 */
export function visibleSettingsGroups(
  fields: SettingsFieldView[] | undefined
): SettingsSection[] {
  const byGroup = new Map<GroupKey, SettingsFieldView[]>();
  for (const f of fields ?? []) {
    const arr = byGroup.get(f.group) ?? [];
    arr.push(f);
    byGroup.set(f.group, arr);
  }
  return GROUPS.filter(
    (g) => LOCAL_GROUPS.has(g.key) || (byGroup.get(g.key)?.length ?? 0) > 0
  ).map((g) => ({ ...g, fields: byGroup.get(g.key) ?? [] }));
}
