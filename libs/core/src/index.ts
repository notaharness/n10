// @n10/core — the shell-agnostic half of n10.
//
// Everything here is plain TypeScript: git, worktrees, PTYs, config,
// providers, keybinding data and pure helpers. Nothing in this library
// imports React, Ink or Electron, and the lint config enforces that.
//
// The shells (the Ink TUI and the Electron desktop) render over this.
// React-flavoured wrappers — contexts, hooks, controllers — live in
// @n10/app-core, which depends on this package and never the reverse.

// ── Input primitives ─────────────────────────────────────────────
export type { KeyPress } from './lib/input/key-press.js';
export { handleTextInput } from './lib/input/handle-text-input.js';

// ── Keybindings ──────────────────────────────────────────────────
export * from './lib/keybindings/index.js';

// ── Settings field model ─────────────────────────────────────────
export {
  AI_PRESETS,
  BOOL_PRESETS,
  BOOL_PRESETS_ON_FIRST,
  EDITOR_PRESETS,
  SHELL_PRESETS,
  SYNC_INTERVAL_PRESETS,
  KEYBIND_PRESETS,
  buildSettingsFields,
  resolveValue,
} from './lib/settings/fields.js';
export type { SettingsField } from './lib/settings/fields.js';
export {
  persistConfigField,
  persistKeybindFields,
} from './lib/settings/persistence.js';
export type { KeybindFields } from './lib/settings/persistence.js';

// ── Domain types ─────────────────────────────────────────────────
export * from './lib/types.js';
export * from './lib/activity-config.js';
export * from './lib/plan/plan-types.js';

// ── Session / PTY infrastructure (Node host side) ────────────────
export * from './lib/session-backend.js';
export * from './lib/session-identity.js';
export * from './lib/session-resolver.js';
export * from './lib/session/session-request.js';
export * from './lib/session/open-session.js';
export type * from './lib/terminal/terminal-name.js';
export * from './lib/terminal/launch-terminal.js';
export * from './lib/pty-registry.js';
export * from './lib/worktree-rows.js';
export {
  attach,
  detach,
  noteInput,
  noteResize,
  noteSeen,
  snapshot,
  idleFor,
  hasUnseenOutput,
  showTerminal,
  __resetForTests as __resetActivityForTests,
} from './lib/activity.js';
export type { ActivitySnapshot } from './lib/activity.js';
export {
  enqueue,
  dequeueOldest,
  remove,
  peekAll,
  size,
  subscribe,
} from './lib/inactive-alerts.js';
export * from './lib/agents/registry.js';
export * from './lib/agents/agent-options.js';
export * from './lib/session/launch-session.js';
export * from './lib/session/session-launch-context.js';
export * from './lib/session/session-menu.js';
export * from './lib/session/session-menu-request.js';
export * from './lib/session/review-prompt.js';
export * from './lib/session/relay-target.js';
export * from './lib/session/claude-inbox.js';
export * from './lib/sync/remote-sync.js';
export * from './lib/sync/conflicts.js';
export * from './lib/sync/fetch-queue.js';
export * from './lib/pull-requests/pr-conversation.js';
export * from './lib/pull-requests/mention-search.js';
export * from './lib/pull-requests/submit-review.js';
export * from './lib/pull-requests/pr-snapshot.js';
export * from './lib/pull-requests/pr-readiness.js';
export * from './lib/pull-requests/pr-readiness-aspects.js';
export * from './lib/pull-requests/pr-check-list.js';
export * from './lib/pull-requests/pr-checks-read.js';
export * from './lib/pull-requests/pr-review-requirements.js';
export type * from './lib/pull-requests/pull-request-lookup.js';
export * from './lib/pull-requests/pr-comparison.js';
export * from './lib/pull-requests/pr-diff-manifest.js';
export * from './lib/pull-requests/blob-sizes.js';
export * from './lib/pull-requests/blob-image.js';
export * from './lib/pull-requests/pr-history.js';
export * from './lib/pull-requests/pr-revision-range.js';
export * from './lib/pull-requests/pr-store-file.js';
export * from './lib/pull-requests/review-checkpoints.js';
export * from './lib/pull-requests/review-draft-anchor.js';
export * from './lib/pull-requests/review-draft-store.js';
export * from './lib/pull-requests/review-draft-types.js';
export * from './lib/pull-requests/review-drafts.js';
export * from './lib/discovery/discovery-model.js';
export * from './lib/babysit/babysit-model.js';
export * from './lib/babysit/babysit-prompt.js';
export * from './lib/discovery/worktree-origin.js';
export * from './lib/discovery/live-worktree-sessions.js';

// ── Pure utilities ───────────────────────────────────────────────
export * from './lib/utils/sidebar-items.js';
export * from './lib/utils/session-sort.js';
export * from './lib/utils/running-tabs.js';
export * from './lib/utils/scroll-window.js';
export * from './lib/utils/truncate.js';
export * from './lib/utils/virtual-viewport.js';
export * from './lib/utils/diff-scroll.js';
export * from './lib/utils/pr-utils.js';
export { gitLine } from './lib/utils/git-run.js';
export * from './lib/utils/worktree-diff.js';
export * from './lib/utils/language.js';
export * from './lib/utils/resolve-preset-name.js';

// ── Plan store ───────────────────────────────────────────────────
// `remove` is aliased because inactive-alerts' unary `remove(name)`
// (re-exported above) would otherwise shadow plan-store's ternary
// `remove(prId, kind, id)` in the barrel namespace.
export {
  add,
  count,
  has,
  list,
  clear,
  toggle,
  annotate,
  subscribe as subscribePlanStore,
  getSnapshot as getPlanSnapshot,
} from './lib/plan/plan-store.js';
export {
  remove as removePlanItem,
  __resetPlanStoreForTest,
} from './lib/plan/plan-store.js';
export * from './lib/plan/prompt-composer.js';

export {
  canonicalWorktreePath,
  resolveRemoteWorktreePath,
  worktreeSessionKey,
  keyForWorktree,
  terminalSessionKey,
  sessionIdentity,
  sessionLabel,
  LOCAL_MACHINE,
} from './lib/session-key.js';
export type { SessionIdentity } from './lib/session-key.js';
export {
  directoryOnMachine,
  homeRelative,
  localHomes,
  remoteWorktreeScope,
} from './lib/machine-paths.js';

export {
  setMachineResolver,
  resolveMachine,
  requireMachine,
  pollerFor,
  setMachineReachable,
  type MachineResolver,
} from './lib/machine-registry.js';

export { stopSession } from './lib/session/stop-session.js';
export {
  checkWorktreeRemoval,
  removeWorktreeSession,
  type WorktreeRemovalCheck,
  type WorktreeRemovalOutcome,
} from './lib/session/remove-worktree.js';
export { setLocalSessionEnv } from './lib/session/local-session-env.js';

export * from './lib/repository.js';

export {
  agentCommentRepository,
  runReviewUtility,
} from './lib/pull-requests/agent-comment-scope.js';
