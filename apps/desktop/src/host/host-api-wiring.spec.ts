import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostApi } from './register-handlers.js';

/**
 * Which service each bridge method reaches, asserted rather than
 * assumed.
 *
 * `createHostApi` is one long object of one-line delegations, and the
 * compiler is happy as long as the signatures line up — so
 * `listWorktrees: () => worktrees.listBranches()` type-checks
 * perfectly and returns the wrong list forever. Nothing else in the
 * suite would notice: the service tests pass, the preload test only
 * proves the *channel* is right, and the renderer would simply show
 * branches where worktrees belong.
 *
 * The table below is the wiring, written down. Each row says which
 * service function a method must call, and the arguments must arrive
 * untouched and in order.
 */

const calls = vi.hoisted(() => [] as { fn: string; args: unknown[] }[]);

/** Record every export of a service module as `module.fn`. */
function recorder(moduleName: string, names: string[]) {
  return Object.fromEntries(
    names.map((fn) => [
      fn,
      (...args: unknown[]) => {
        calls.push({ fn: `${moduleName}.${fn}`, args });
        return Promise.resolve(`${moduleName}.${fn}`);
      },
    ])
  );
}

vi.mock('./services/repo.js', () =>
  recorder('repo', [
    'openRepo',
    'getRepo',
    'refreshRepo',
    'listRecentRepos',
    'forgetRecentRepo',
  ])
);
vi.mock('./services/settings.js', () =>
  recorder('settings', ['getSettingsView', 'updateSettingsFromView'])
);
vi.mock('./services/sidebar.js', () =>
  recorder('sidebar', ['getSidebarSnapshot', 'getSyncState', 'refreshRemote'])
);
vi.mock('./services/worktrees.js', () =>
  recorder('worktrees', [
    'listWorktrees',
    'listBranches',
    'listAllBranches',
    'createWorktree',
    'removeWorktree',
    'checkWorktreeRemoval',
    'openInEditor',
    'getWorktreeDiffText',
  ])
);
vi.mock('./services/reviews.js', () =>
  recorder('reviews', [
    'fetchCommentThreads',
    'replyToThread',
    'setThreadResolved',
    'fetchPrDescription',
    'submitReviewVerdict',
    'getReviewViewer',
    'getDiffText',
  ])
);
vi.mock('./services/sessions.js', () =>
  recorder('sessions', [
    'launchAgent',
    'launchReviewAgent',
    'listAgentOptions',
    'getSessionLaunchContext',
    'checkoutPlan',
    'listSessions',
    'getSessionActivity',
    'watchSession',
    'unwatchSession',
    'showSession',
    'hideSession',
    'writeSession',
    'resizeSession',
    'killSession',
    'reconnectSession',
  ])
);
vi.mock('./services/terminals.js', () =>
  recorder('terminals', ['launchTerminal', 'listTerminals', 'killTerminal'])
);
vi.mock('./services/branch-sessions.js', () =>
  recorder('branchSessions', [
    'listTerminals',
    'listBranchSessions',
    'launchBranchTerminal',
  ])
);
vi.mock('./services/foreign-sessions.js', () =>
  recorder('foreignSessions', ['listForeignSessions'])
);
vi.mock('./services/comment-images.js', () =>
  recorder('commentImages', ['fetchCommentImage'])
);
vi.mock('./services/clipboard-image.js', () =>
  recorder('clipboardImage', ['saveClipboardImage'])
);
vi.mock('./services/pr-checks.js', () =>
  recorder('prChecks', ['getPullRequestChecks'])
);
vi.mock('./services/pr-details.js', () =>
  recorder('prDetails', ['getPullRequestSnapshot'])
);
vi.mock('./services/pr-conversation.js', () =>
  recorder('prConversation', ['getPullRequestConversation'])
);
vi.mock('./services/review-drafts.js', () =>
  recorder('reviewDrafts', [
    'listDrafts',
    'saveDraft',
    'discardDraft',
    'submitReview',
  ])
);
vi.mock('./services/mentions.js', () =>
  recorder('mentions', ['searchMentionCandidates'])
);
vi.mock('./services/drafts.js', () =>
  recorder('drafts', [
    'listDraftComments',
    'updateDraftComment',
    'deleteDraftComment',
    'postDraftComments',
  ])
);
vi.mock('./services/babysit.js', () =>
  recorder('babysit', ['startBabysit', 'stopBabysit'])
);
vi.mock('./services/desktop-prefs.js', () =>
  recorder('prefs', ['loadDesktopPrefs', 'saveDesktopPrefs'])
);
vi.mock('./services/theme.js', () => recorder('theme', ['getTheme']));
vi.mock('./services/machines.js', () =>
  recorder('machines', [
    'listMachines',
    'getBeamStatus',
    'setMachineAlias',
    'setMachineGrant',
    'runCeremony',
    'cancelCeremony',
    'resetFleet',
  ])
);
vi.mock('./services/inbound-mail.js', () =>
  recorder('inboundMail', ['dismissInboundMail'])
);

const { createHostApi, createViewerApi } = await import(
  './register-handlers.js'
);

let api: HostApi;

beforeEach(() => {
  calls.length = 0;
  api = createHostApi();
});

/** method → the service call it must make, given these arguments. */
const WIRING: [keyof HostApi, unknown[], string][] = [
  ['openRepo', ['/repo'], 'repo.openRepo'],
  ['getRepo', [], 'repo.getRepo'],
  ['refreshRepo', [], 'repo.refreshRepo'],
  ['listRecentRepos', [], 'repo.listRecentRepos'],
  ['forgetRecent', ['/repo'], 'repo.forgetRecentRepo'],

  ['getSettingsView', [], 'settings.getSettingsView'],
  [
    'updateSettingsField',
    [{ label: 'Editor', key: 'editor' }, 'vim'],
    'settings.updateSettingsFromView',
  ],

  ['getSidebarModel', [], 'sidebar.getSidebarSnapshot'],
  ['getSyncState', [], 'sidebar.getSyncState'],
  ['refreshRemote', [], 'sidebar.refreshRemote'],

  ['listWorktrees', [], 'worktrees.listWorktrees'],
  ['listBranches', [], 'worktrees.listBranches'],
  ['listAllBranches', [], 'worktrees.listAllBranches'],
  ['createWorktree', ['feature'], 'worktrees.createWorktree'],
  [
    'removeWorktree',
    [
      'feature',
      {
        verdict: 'clear',
        tip: 'abc123',
        repo: '/repo/.git',
        checkout: '/repo/wt',
      },
    ],
    'worktrees.removeWorktree',
  ],
  ['checkWorktreeRemoval', ['feature'], 'worktrees.checkWorktreeRemoval'],
  ['openInEditor', ['feature'], 'worktrees.openInEditor'],

  ['fetchCommentThreads', [7, true], 'reviews.fetchCommentThreads'],
  ['fetchPrDescription', [7], 'reviews.fetchPrDescription'],
  [
    'getPullRequestSnapshot',
    [{ ref: { number: 7 } }],
    'prDetails.getPullRequestSnapshot',
  ],
  [
    'getPullRequestChecks',
    [{ ref: { number: 7 } }],
    'prChecks.getPullRequestChecks',
  ],
  [
    'getPullRequestConversation',
    [{ ref: { number: 7 } }],
    'prConversation.getPullRequestConversation',
  ],
  ['listReviewDrafts', [{ ref: { number: 7 } }], 'reviewDrafts.listDrafts'],
  ['saveReviewDraft', [{ ref: { number: 7 } }], 'reviewDrafts.saveDraft'],
  ['discardReviewDraft', [{ ref: { number: 7 } }], 'reviewDrafts.discardDraft'],
  ['submitReview', [{ ref: { number: 7 } }], 'reviewDrafts.submitReview'],
  [
    'searchMentionCandidates',
    [{ ref: { number: 7 }, query: 'al' }],
    'mentions.searchMentionCandidates',
  ],
  [
    'replyToThread',
    [{ prId: 7, thread: { id: 't' }, body: 'hi' }],
    'reviews.replyToThread',
  ],
  [
    'setThreadResolved',
    [{ prId: 7, thread: { id: 't' }, resolved: true }],
    'reviews.setThreadResolved',
  ],
  ['submitReviewVerdict', [7, 'approve'], 'reviews.submitReviewVerdict'],
  ['getReviewViewer', [], 'reviews.getReviewViewer'],
  ['fetchDiffText', ['feature', 'main'], 'reviews.getDiffText'],
  [
    'fetchWorktreeDiffText',
    ['feature', 'main'],
    'worktrees.getWorktreeDiffText',
  ],

  ['fetchCommentImage', ['https://x/y.png'], 'commentImages.fetchCommentImage'],
  [
    'saveClipboardImage',
    [new Uint8Array([1, 2]), 'image/png'],
    'clipboardImage.saveClipboardImage',
  ],

  ['listDraftComments', [7], 'drafts.listDraftComments'],
  ['updateDraftComment', [7, 'id', { body: 'x' }], 'drafts.updateDraftComment'],
  ['deleteDraftComment', [7, 'id'], 'drafts.deleteDraftComment'],
  ['postDraftComments', [{ prId: 7 }], 'drafts.postDraftComments'],

  ['launchAgent', [{ branch: 'b' }], 'sessions.launchAgent'],
  ['launchReviewAgent', [{ pr: {} }], 'sessions.launchReviewAgent'],
  ['listAgentOptions', [], 'sessions.listAgentOptions'],
  ['getSessionLaunchContext', ['feature'], 'sessions.getSessionLaunchContext'],
  [
    'checkoutPlan',
    [{ pr: {}, prompt: 'p', mode: 'inject' }],
    'sessions.checkoutPlan',
  ],
  ['listSessions', [], 'sessions.listSessions'],
  ['listForeignSessions', [], 'foreignSessions.listForeignSessions'],
  ['getSessionActivity', [], 'sessions.getSessionActivity'],
  ['writeSession', ['b', 'ls\n'], 'sessions.writeSession'],
  ['resizeSession', ['b', 120, 40], 'sessions.resizeSession'],
  ['killSession', ['b'], 'sessions.killSession'],
  ['reconnectSession', ['b'], 'sessions.reconnectSession'],

  [
    'launchTerminal',
    [{ kind: 'shell', cwd: '/x' }],
    'terminals.launchTerminal',
  ],
  ['listTerminals', [], 'branchSessions.listTerminals'],
  ['killTerminal', ['n10-shell'], 'terminals.killTerminal'],
  ['listBranchSessions', ['feature'], 'branchSessions.listBranchSessions'],
  [
    'launchBranchTerminal',
    [{ branch: 'feature', machine: 'peer' }],
    'branchSessions.launchBranchTerminal',
  ],

  ['getDesktopPrefs', [], 'prefs.loadDesktopPrefs'],
  ['getTheme', [], 'theme.getTheme'],

  ['startBabysit', [7], 'babysit.startBabysit'],
  ['stopBabysit', [7], 'babysit.stopBabysit'],

  ['listMachines', [], 'machines.listMachines'],
  ['getBeamStatus', [], 'machines.getBeamStatus'],
  [
    'setMachineAlias',
    ['bbbbbbbbbbbbbbbb', 'workbox'],
    'machines.setMachineAlias',
  ],
  ['setMachineGrant', ['bbbbbbbbbbbbbbbb', 'msg'], 'machines.setMachineGrant'],
  ['runCeremony', [{ op: 'join', label: 'box' }], 'machines.runCeremony'],
  ['cancelCeremony', [], 'machines.cancelCeremony'],
  ['resetFleet', [], 'machines.resetFleet'],
  ['dismissInboundMail', ['env-1'], 'inboundMail.dismissInboundMail'],
];

describe('host API wiring', () => {
  it.each(WIRING)('%s reaches %s', async (method, args, expected) => {
    // The table is heterogeneous by construction — each row has its own
    // signature — so the call is made through the widest function type
    // rather than through `any`, which would also erase the await.
    await (api[method] as (...a: unknown[]) => unknown)(...args);
    expect(calls.map((c) => c.fn)).toEqual([expected]);
    expect(calls[0].args).toEqual(args);
  });

  it('covers every method that delegates to a service', () => {
    // Guards the table itself: a method added to the contract without a
    // row here would otherwise be silently unwired and untested.
    const notDelegating = new Set([
      'getVersion', // built inline from process.versions
      'selectRepoDirectory', // native dialog, injected by main.ts
      'selectFolder', // the same dialog, any folder
      'openExternal',
      'showContextMenu',
      'showAppMenu',
      'showAbout',
      'setDesktopPrefs', // also notifies main.ts; covered separately
      'onSessionData',
      'onSessionExit',
      'onLaunchStep',
      'onMenuCommand',
      'onThemeChanged',
      'onBabysitChanged',
      'onSyncNotice',
      'onRemoteUpdated',
      'onDiscoveryChanged',
      'onMachinesChanged',
      'onBeamStatusChanged',
      'onCeremonyProgress',
      'onDirectoryPublished',
    ]);
    const covered = new Set(WIRING.map(([m]) => m));
    const missing = Object.keys(api).filter(
      (m) => !covered.has(m as keyof HostApi) && !notDelegating.has(m)
    );
    expect(missing).toEqual([]);
  });

  it.each([
    ['watchSession', 'sessions.watchSession'],
    ['unwatchSession', 'sessions.unwatchSession'],
    ['showSession', 'sessions.showSession'],
    ['hideSession', 'sessions.hideSession'],
  ] as const)(
    '%s reaches %s with the asking window',
    async (method, expected) => {
      await createViewerApi()[method](7, 'b');
      expect(calls).toEqual([{ fn: expected, args: [7, 'b'] }]);
    }
  );

  it('reports the running versions rather than a service call', () => {
    // getVersion is the one method that answers from the process
    // itself; it must not start delegating by accident.
    return api.getVersion().then((v) => {
      expect(v.node).toBe(process.versions.node);
      expect(calls).toEqual([]);
    });
  });
});
