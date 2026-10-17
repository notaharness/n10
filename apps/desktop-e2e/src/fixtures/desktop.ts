import {
  test as base,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cleanupTestRepo,
  createTestRepo,
  type TestRepoOptions,
} from '../setup/git-repo.js';
import { killFixtureSessions } from '../setup/tmux.js';
import { appEnv } from './app-env.js';
import { fakeAdoMisses } from '../setup/fake-ado.js';
import {
  networkGuardBase,
  takeNetworkRefusals,
} from '../setup/network-guard.js';
import {
  WORKSPACE_ROOT,
  forgetPreloads,
  launchArgs,
  missingPreloads,
  requirePreloads,
} from './launch.js';
import { closeDesktopApp } from '../setup/app-close.js';
import { launchAgain } from '../setup/launch-again.js';
import { readyWindow } from './ready-window.js';
import type { TerminalSeed } from '../setup/terminals.js';
import {
  fakeAgent,
  seedHome,
  seedTmux,
  type HomeSeed,
  type LiveSessionSeed,
} from './seed-home.js';

export { fakeAgent };

export interface DesktopOptions extends HomeSeed {
  /** Seed options for the per-test git repo. */
  repo?: TestRepoOptions;
  /**
   * Start with no repo open (the repo picker screen) instead of
   * pointing N10_START_DIR at the test repo.
   */
  startWithoutRepo?: boolean;
  /**
   * Open this path instead of a freshly created throwaway repo. The
   * caller owns its lifecycle — used by the integration tests, which
   * clone the shared sandbox repo once per file.
   */
  repoPathOverride?: string;
  /** Give the window WebGL, in software (SwiftShader), so terminals
   *  draw with xterm's WebGL renderer. Without it there is no GPU and
   *  they use xterm's DOM renderer, whose rows are text to assert on. */
  webgl?: boolean;
  /** Create the test repo inside the app's HOME (`fixtureHome`), where
   *  a path is home-relative, instead of a temp directory beside it. */
  repoInHome?: boolean;
  /**
   * Hand the app a GitHub token. Its HOME is isolated, so the `gh` CLI
   * it authenticates through cannot see the developer's stored
   * credentials; without this it behaves as a repo with no provider.
   */
  githubToken?: string;
  /**
   * Agent sessions already running when the app starts — the state
   * after a previous run whose agents were left in tmux. Each is a
   * worktree added with plain git plus a tmux session under the name
   * n10 uses, on the test's own socket. Data rather than a callback: Playwright
   * reads a function-valued option as a fixture definition. `repo`
   * puts the agent in another repository than the test's own — the
   * state after a run that had work open across several.
   */
  liveSessions?: LiveSessionSeed[];
  /**
   * Extra environment for the app process, for the knobs the host
   * reads from it — a background cadence a test cannot wait out at its
   * real value. Cannot override the isolation the fixture sets up
   * (HOME, the tmux socket, the fake `gh`), which is applied after.
   */
  env?: Record<string, string>;
  /**
   * Terminal tabs already running when the app starts — the state after
   * a previous run that opened them was quit, since quitting only
   * detaches. Each is a tmux session tagged as a terminal tab of the
   * given kind (shell unless said), in the given directory, on the
   * test's own socket.
   *
   * Keyed by session name rather than listed: Playwright reads any
   * array whose second element is an object as a `[value, options]`
   * fixture tuple, so a two-entry list arrives as its first entry.
   */
  liveTerminals?: Record<string, TerminalSeed>;
}

export interface DesktopApp {
  app: ElectronApplication;
  page: Page;
  repoPath: string;
  homeDir: string;
  /** Renderer errors seen so far — the fixture fails the test on any. */
  pageErrors: string[];
  /** Evaluate in the main process (e.g. to inspect host services). */
  main: ElectronApplication['evaluate'];
  /**
   * Launch the app again while this one runs, as a user would from a
   * shell in `startDir` (the npm launcher's `N10_START_DIR`). Resolves
   * once that process has handed over and quit.
   */
  launchAgain: (startDir: string) => Promise<void>;
  /** Quit the app and start it again on the same HOME, tmux socket and
   *  environment, as a user closing and reopening n10 would. `app`,
   *  `page` and `main` then answer for the new process. `startPath`
   *  opens another repository path, such as a relocated or symlinked
   *  copy of the test repo. Fails if the old process did not exit. */
  relaunch(startPath?: string): Promise<void>;
  /** Quit the app and fail unless the process exited, for a test that
   *  changes the repository while n10 is not running. */
  stop(): Promise<void>;
}

export const test = base.extend<
  DesktopOptions & { desktop: DesktopApp; fixtureHome: string }
>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured fixture dependency parameter.
  fixtureHome: async ({}, provide) => {
    const homeDir = mkdtempSync(join(tmpdir(), 'n10-desktop-e2e-home-'));
    try {
      await provide(homeDir);
    } finally {
      killFixtureSessions(homeDir);
      await rm(homeDir, { recursive: true, force: true });
    }
  },
  n10Config: [undefined, { option: true }],
  projectConfig: [undefined, { option: true }],
  desktopPrefs: [undefined, { option: true }],
  repo: [undefined, { option: true }],
  startWithoutRepo: [false, { option: true }],
  repoPathOverride: [undefined, { option: true }],
  repoInHome: [false, { option: true }],
  webgl: [false, { option: true }],
  githubToken: [undefined, { option: true }],
  drafts: [undefined, { option: true }],
  guides: [undefined, { option: true }],
  fakeGitHub: [undefined, { option: true }],
  fakeAzureDevOps: [undefined, { option: true }],
  tmuxConf: [undefined, { option: true }],
  liveSessions: [undefined, { option: true }],
  env: [undefined, { option: true }],
  liveTerminals: [undefined, { option: true }],

  desktop: async (
    {
      n10Config,
      projectConfig,
      desktopPrefs,
      repo,
      startWithoutRepo,
      repoPathOverride,
      repoInHome,
      webgl,
      githubToken,
      drafts,
      guides,
      fakeGitHub,
      fakeAzureDevOps,
      tmuxConf,
      liveSessions,
      env,
      liveTerminals,
      fixtureHome,
    },
    // Playwright's fixture callback. Named `provide` rather than the
    // conventional `use` so it does not read as a React hook call to
    // the react-hooks rules, which run over this workspace.
    provide,
    testInfo
  ) => {
    // A repo in the fixture HOME goes with it.
    const ownsRepo = !repoPathOverride && !repoInHome;
    const repoPath =
      repoPathOverride ??
      createTestRepo({
        ...repo,
        ...(repoInHome ? { parent: fixtureHome } : {}),
      });
    const homeDir = fixtureHome;
    const ghEnv = seedHome(homeDir, repoPath, {
      n10Config,
      projectConfig,
      desktopPrefs,
      drafts,
      guides,
      fakeGitHub,
      fakeAzureDevOps,
      tmuxConf,
    });

    seedTmux(repoPath, homeDir, liveSessions, liveTerminals);
    // A real token is the @integration suite reaching GitHub on purpose.
    const networkGuard = githubToken ? undefined : networkGuardBase(homeDir);

    const envFor = (startPath: string) =>
      appEnv({
        homeDir,
        repoPath: startPath,
        startWithoutRepo,
        githubToken,
        ghEnv,
        networkGuard,
        extra: env,
      });
    const wanted = {
      ado: fakeAzureDevOps !== undefined,
      guard: networkGuard !== undefined,
    };
    const launch = async (startPath: string): Promise<ElectronApplication> => {
      // A relaunch proves its own preloads, not the first launch's.
      forgetPreloads(homeDir);
      return electron.launch({
        args: launchArgs(wanted.guard, webgl),
        cwd: WORKSPACE_ROOT,
        env: envFor(startPath),
        timeout: 60_000,
      });
    };
    let app = await launch(repoPath);

    const page = await app.firstWindow();
    await requirePreloads(
      app,
      missingPreloads(homeDir, wanted),
      () => ownsRepo && cleanupTestRepo(repoPath)
    );

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    await readyWindow(app, page, startWithoutRepo, pageErrors, consoleErrors);

    // Bounded, and never the reason a test fails: see setup/app-close.ts.
    // A test that stopped the app itself leaves nothing for teardown.
    let stopped = false;
    async function close() {
      if (stopped) return { exited: true, note: null };
      const result = await closeDesktopApp(app);
      stopped = true;
      if (result.note) {
        console.warn(`[desktop-e2e] ${result.note}`);
        await testInfo.attach('desktop-close', {
          body: result.note,
          contentType: 'text/plain',
        });
      }
      return result;
    }
    async function stop(): Promise<void> {
      const result = await close();
      if (!result.exited)
        throw new Error(result.note ?? 'Electron did not exit');
    }

    const desktop: DesktopApp = {
      app,
      page,
      repoPath,
      homeDir,
      pageErrors,
      main: app.evaluate.bind(app),
      launchAgain: (startDir) =>
        launchAgain({
          args: launchArgs(wanted.guard, webgl),
          cwd: WORKSPACE_ROOT,
          env: { ...envFor(repoPath), N10_START_DIR: startDir },
        }),
      stop,
      async relaunch(startPath = repoPath) {
        await stop();
        app = await launch(startPath);
        stopped = false;
        const next = await app.firstWindow();
        // The test's teardown cleans up after it.
        await requirePreloads(app, missingPreloads(homeDir, wanted));
        await readyWindow(
          app,
          next,
          startWithoutRepo,
          pageErrors,
          consoleErrors
        );
        Object.assign(desktop, {
          app,
          page: next,
          main: app.evaluate.bind(app),
        });
      },
    };
    let used = false;
    let refusals: string[] = [];
    try {
      await provide(desktop);
      used = true;
    } finally {
      if (consoleErrors.length) {
        await testInfo.attach('renderer-console-errors', {
          body: consoleErrors.join('\n'),
          contentType: 'text/plain',
        });
      }
      await close();
      if (ownsRepo) cleanupTestRepo(repoPath);
      // Attached whether or not the test got far enough to fail on
      // them: a refused request is often why it failed.
      if (networkGuard) refusals = takeNetworkRefusals(homeDir);
      if (refusals.length) {
        await testInfo.attach('network-refusals', {
          body: refusals.join('\n'),
          contentType: 'text/plain',
        });
      }
    }

    // Only when the test itself got that far, so a real assertion
    // failure keeps priority.
    if (used) {
      afterEffects(
        pageErrors,
        fakeAzureDevOps ? fakeAdoMisses(homeDir) : [],
        refusals
      );
    }
  },
});

/** What a test that passed must not have left behind. An uncaught
 *  renderer exception blanks a pane behind the ErrorBoundary, which a
 *  passing assertion elsewhere would happily ignore; a request the
 *  Azure DevOps fake does not model was answered 404, and one off this
 *  machine was refused — failures the test did not ask for. */
function afterEffects(
  pageErrors: string[],
  misses: string[],
  refusals: string[]
): void {
  if (pageErrors.length > 0) {
    throw new Error(
      `Renderer threw during the test:\n${pageErrors.join('\n---\n')}`
    );
  }
  if (misses.length > 0) {
    throw new Error(
      `The app made requests the Azure DevOps fake does not model:\n${misses.join(
        '\n'
      )}`
    );
  }
  if (refusals.length > 0) {
    throw new Error(
      `The app reached off this machine, past the fakes:\n${refusals.join(
        '\n'
      )}`
    );
  }
}

export { expect };
