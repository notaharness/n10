import type { Tab } from './tab-identity.js';
import { terminalTabId } from './tab-identity.js';
import type { TabsState } from './tabs-model.js';

type RecordValue = Record<string, unknown>;

function record(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function stringRecord(value: unknown): value is Record<string, string> {
  return (
    record(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  );
}

function validTags(tags: unknown, item: boolean): boolean {
  if (!stringRecord(tags)) return false;
  if (!tags['@orchestra-spawner'] || !tags['@orchestra-session-type'])
    return false;
  return (
    !item || (!!tags['@orchestra-repo'] && !!tags['@orchestra-worktree-path'])
  );
}

function validRuntime(value: RecordValue): boolean {
  return (
    optionalString(value.agent) &&
    (value.env === undefined || stringRecord(value.env)) &&
    optionalString(value.conversationId)
  );
}

/** The session the tab reattaches to while it runs: a tmux session
 *  named by its label. */
function sessionTarget(value: unknown): boolean {
  return (
    record(value) &&
    value.kind === 'tmux' &&
    typeof value.name === 'string' &&
    value.name !== ''
  );
}

function restore(value: unknown, item: boolean): boolean {
  if (value === undefined) return true;
  if (!record(value)) return false;
  if (!sessionTarget(value.target)) return false;
  if (!validTags(value.tags, item) || !validRuntime(value)) return false;
  return item
    ? typeof value.sessionName === 'string' && optionalString(value.aiCommand)
    : value.sessionName === undefined;
}

function itemTab(value: RecordValue): boolean {
  return (
    typeof value.repo === 'string' &&
    typeof value.itemKey === 'string' &&
    typeof value.preview === 'boolean' &&
    optionalString(value.branch) &&
    optionalString(value.worktree) &&
    optionalString(value.originBranch) &&
    optionalString(value.title) &&
    optionalString(value.sessionName) &&
    restore(value.restore, true) &&
    (!record(value.restore) || value.sessionName === value.restore.sessionName)
  );
}

function terminalTab(value: RecordValue): boolean {
  return (
    typeof value.name === 'string' &&
    value.id === terminalTabId(value.name) &&
    (value.terminalKind === 'agent' || value.terminalKind === 'shell') &&
    typeof value.cwd === 'string' &&
    typeof value.displayPath === 'string' &&
    (value.repo === null || typeof value.repo === 'string') &&
    value.preview === false &&
    typeof value.listed === 'boolean' &&
    restore(value.restore, false)
  );
}

function tab(value: unknown): value is Tab {
  if (!record(value) || typeof value.id !== 'string') return false;
  if (value.kind === 'settings')
    return value.id === 'settings' && value.preview === false;
  if (
    value.resumeRequired !== undefined &&
    typeof value.resumeRequired !== 'boolean'
  )
    return false;
  if (value.resumeRequired === true && value.restore === undefined)
    return false;
  if (value.kind === 'item') return itemTab(value);
  return value.kind === 'terminal' && terminalTab(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function validState(value: RecordValue): boolean {
  return (
    Array.isArray(value.tabs) &&
    value.tabs.every(tab) &&
    stringArray(value.autoOpened) &&
    stringArray(value.unseen) &&
    stringRecord(value.lastActiveByRepo) &&
    (value.activeId === null || typeof value.activeId === 'string')
  );
}

export function encodeTabs(state: TabsState): unknown {
  return { version: 1, state };
}

export function decodeTabs(value: unknown): TabsState | null {
  if (!record(value) || value.version !== 1 || !record(value.state))
    return null;
  const state = value.state;
  if (!validState(state)) return null;
  const tabs = state.tabs as Tab[];
  const ids = new Set(tabs.map((entry) => entry.id));
  if (ids.size !== tabs.length) return null;
  if (state.activeId && !ids.has(state.activeId as string)) return null;
  return {
    tabs,
    activeId: state.activeId as string | null,
    autoOpened: state.autoOpened as string[],
    unseen: (state.unseen as string[]).filter((id) => ids.has(id)),
    lastActiveByRepo: state.lastActiveByRepo as Record<string, string>,
  };
}
