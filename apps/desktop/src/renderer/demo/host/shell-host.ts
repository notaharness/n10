import type { MenuCommandEvent } from '../../../host/contract-events.js';
import type {
  DesktopKeybindings,
  DesktopPrefs,
  N10HostApi,
  RepoInfo,
  SettingsFieldView,
} from '../../../host/contract.js';
import { VIEWER } from '../data/identity.js';
import { requestedTheme } from '../embed.js';
import { showAppMenu } from '../native/app-menu.js';
import { showContextMenu } from '../native/context-menu.js';
import { pickFolder } from '../native/folder-picker.js';
import { Channel, later } from './hub.js';
import type { DemoState, RepoState } from './state.js';

/**
 * The window around the repositories: which one is open and the recent
 * list, settings, the OS surfaces (folder picker, context menus, drawn
 * in the page by native/) and the machines of the fleet. Anything that
 * would leave the page (a browser tab, an editor, a passkey) is a
 * no-op.
 */
const info = (repo: RepoState): RepoInfo => ({
  cwd: repo.cwd,
  providerId: 'github',
  vcsConfigured: true,
  repository: {
    provider: 'github',
    host: 'github.com',
    repository: repo.data.slug,
  },
  viewer: VIEWER,
  // GitHub's verdicts, as its provider declares them.
  reviewEvents: ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'],
});

const SETTINGS: SettingsFieldView[] = [
  {
    label: 'Agent',
    key: 'agentId',
    group: 'agent',
    kind: 'select',
    value: 'claude',
    presets: [
      { name: 'Claude Code', value: 'claude' },
      { name: 'Codex', value: 'codex' },
      { name: 'Gemini CLI', value: 'gemini' },
      { name: 'GitHub Copilot', value: 'copilot' },
      { name: 'OpenCode', value: 'opencode' },
    ],
  },
  {
    label: 'Worktree Path',
    key: 'worktreePath',
    group: 'general',
    kind: 'text',
    value: '',
    defaultValue: '.claude/worktrees/{session}',
    description:
      'Template for worktree placement ({session} = sanitized branch). Restart required.',
  },
  {
    label: 'Refresh interval',
    key: 'prPollInterval',
    group: 'sync',
    kind: 'text',
    value: '60',
    description: 'Seconds between pull request refreshes.',
  },
  {
    label: 'Personal access token',
    key: 'token',
    group: 'provider',
    kind: 'text',
    masked: true,
    value: '••••••••',
  },
];

type ShellHost = Pick<
  N10HostApi,
  | 'getVersion'
  | 'openRepo'
  | 'getRepo'
  | 'refreshRepo'
  | 'getRepoInfo'
  | 'listRecentRepos'
  | 'selectRepoDirectory'
  | 'selectFolder'
  | 'forgetRecent'
  | 'getSettingsView'
  | 'updateSettingsField'
  | 'showContextMenu'
  | 'showAppMenu'
  | 'onMenuCommand'
  | 'getDesktopPrefs'
  | 'setDesktopPrefs'
  | 'getKeybindings'
  | 'setKeybinding'
  | 'holdMenuShortcuts'
  | 'showAbout'
>;

export function createShellHost(state: DemoState): ShellHost {
  let prefs: DesktopPrefs = {
    theme: requestedTheme() ?? 'system',
    nativeFrame: false,
    tabOverflow: 'wrap',
    tabCycleMru: false,
    guidedReview: true,
    imageCompare: 'side-by-side',
  };
  let keybindings: DesktopKeybindings = {};
  const menuCommands = new Channel<MenuCommandEvent>();
  return {
    getVersion: () =>
      later({ app: '1.0.0', electron: '44.0.0', node: '24.4.0', chrome: '' }),
    openRepo: async (cwd) => {
      await later(null, 250);
      return info(state.open(cwd));
    },
    getRepo: () => later(info(state.repo())),
    refreshRepo: () => later(info(state.repo())),
    getRepoInfo: (cwd) => later(info(state.repoAt(cwd))),
    listRecentRepos: () =>
      later(
        state.recent.map((cwd, i) => ({
          cwd,
          lastOpenedAt: Date.now() - i * 3_600_000,
          valid: true,
          color: state.colors.get(cwd) ?? 0,
        }))
      ),
    selectRepoDirectory: () => pickFolder('Open a repository'),
    selectFolder: () => pickFolder('Choose a folder'),
    forgetRecent: (cwd) => {
      state.forget(cwd);
      return later(undefined);
    },
    getSettingsView: () => later(SETTINGS),
    updateSettingsField: () => later(undefined),
    showContextMenu,
    showAppMenu: () =>
      showAppMenu(prefs.theme, (command, arg) =>
        menuCommands.emit({ command, arg })
      ),
    onMenuCommand: menuCommands.subscribe,
    getDesktopPrefs: () => later(prefs),
    setDesktopPrefs: (patch) => {
      prefs = { ...prefs, ...patch };
      return later(prefs);
    },
    getKeybindings: () => later(keybindings),
    setKeybinding: (actionId, descriptors) => {
      const rest = Object.fromEntries(
        Object.entries(keybindings).filter(([id]) => id !== actionId)
      );
      keybindings = descriptors ? { ...rest, [actionId]: descriptors } : rest;
      return later(keybindings);
    },
    // The demo's menu is web-rendered and has no accelerators.
    holdMenuShortcuts: () => later(undefined),
    showAbout: () => later(undefined),
  };
}
