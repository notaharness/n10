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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupTestRepo,
  createTestRepo,
  type TestRepoOptions,
} from '../setup/git-repo.js';
import { killFixtureSessions } from '../setup/tmux.js';
import { appEnv } from './app-env.js';
import { fakeAdoLoaded, fakeAdoMisses } from '../setup/fake-ado.js';
import { closeDesktopApp } from '../setup/app-close.js';
import type { TerminalSeed } from '../setup/terminals.js';
import {
  fakeAgent,
  seedHome,
  seedTmux,
  type HomeSeed,
  type LiveSessionSeed,
} from './seed-home.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** apps/desktop — Electron resolves `main` from its package.json. */
const APP_DIR = resolve(HERE, '..', '..', '..', 'desktop');
const WORKSPACE_ROOT = resolve(APP_DIR, '..', '..');

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
  /** Quit the app and start it again on the same HOME, tmux socket and
   *  environment, as a user closing and reopening n10 would. `app`,
   *  `page` and `main` then answer for the new process. */
  relaunch(): Promise<void>;
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
      fakeGitHub,
      fakeAzureDevOps,
      tmuxConf,
    });

    seedTmux(repoPath, homeDir, liveSessions, liveTerminals);

    const launchEnv = appEnv({
      homeDir,
      repoPath,
      startWithoutRepo,
      githubToken,
      ghEnv,
      extra: env,
    });
    let app = await electron.launch({
      args: launchArgs(webgl),
      cwd: WORKSPACE_ROOT,
      env: launchEnv,
      timeout: 60_000,
    });

    const page = await app.firstWindow();
    if (fakeAzureDevOps) {
      await requireFakeAdo(
        app,
        homeDir,
        () => ownsRepo && cleanupTestRepo(repoPath)
      );
    }

    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    await readyWindow(app, page, startWithoutRepo, pageErrors, consoleErrors);

    const desktop: DesktopApp = {
      app,
      page,
      repoPath,
      homeDir,
      pageErrors,
      main: app.evaluate.bind(app),
      async relaunch() {
        await closeDesktopApp(app);
        app = await electron.launch({
          args: launchArgs(webgl),
          cwd: WORKSPACE_ROOT,
          env: launchEnv,
          timeout: 60_000,
        });
        const next = await app.firstWindow();
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
      // Bounded, and never the reason a test fails: see setup/app-close.ts.
      const closeNote = await closeDesktopApp(app);
      if (closeNote) {
        console.warn(`[desktop-e2e] ${closeNote}`);
        await testInfo.attach('desktop-close', {
          body: closeNote,
          contentType: 'text/plain',
        });
      }
      if (ownsRepo) cleanupTestRepo(repoPath);
    }

    // Only when the test itself got that far, so a real assertion
    // failure keeps priority.
    if (used) {
      afterEffects(pageErrors, fakeAzureDevOps ? fakeAdoMisses(homeDir) : []);
    }
  },
});

/**
 * Make a launched window ready for a test. Chromium throttles
 * requestAnimationFrame in a window it considers hidden or occluded, and
 * under xvfb (or behind another window on a developer's desktop) that is
 * the normal state. Playwright's actionability check waits for two
 * consecutive stable animation frames before it will click, so a
 * throttled window makes every click hang until the timeout even though
 * the page is perfectly idle. Show, focus and un-throttle before any
 * test touches it, and collect what the renderer reports as errors.
 */
async function readyWindow(
  app: ElectronApplication,
  page: Page,
  startWithoutRepo: boolean | undefined,
  pageErrors: string[],
  consoleErrors: string[]
): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    win.webContents.setBackgroundThrottling(false);
    win.show();
    win.focus();
  });
  page.on('pageerror', (err) =>
    pageErrors.push(err.stack || err.message || String(err))
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.waitForLoadState('domcontentloaded');
  if (startWithoutRepo) return;
  // The workspace has rendered (not the repo picker, not a blank
  // window) once the sidebar's actions exist.
  await page
    .getByRole('button', { name: 'New worktree', exact: true })
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
}

/** Electron's arguments. */
function launchArgs(webgl?: boolean): string[] {
  return [
    APP_DIR,
    // CI runners have no user namespaces for the sandbox, and
    // software rendering is both available and deterministic.
    '--no-sandbox',
    '--disable-gpu',
    '--ozone-platform=x11',
    // WebGL with no GPU, which Chromium allows only when asked.
    ...(webgl ? ['--enable-unsafe-swiftshader'] : []),
  ];
}

/** Stop unless the Azure DevOps fake is in the session host. The
 *  preload writes the token, so without it the app has no credentials
 *  and has asked Azure nothing; it is stopped all the same. */
async function requireFakeAdo(
  app: ElectronApplication,
  homeDir: string,
  cleanup: () => void
): Promise<void> {
  if (fakeAdoLoaded(homeDir)) return;
  await closeDesktopApp(app);
  cleanup();
  throw new Error('The Azure DevOps fake did not load');
}

/** What a test that passed must not have left behind. An uncaught
 *  renderer exception blanks a pane behind the ErrorBoundary, which a
 *  passing assertion elsewhere would happily ignore; a request the
 *  Azure DevOps fake does not model was answered 404, a failure the
 *  test did not ask for. */
function afterEffects(pageErrors: string[], misses: string[]): void {
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
}

export { expect };
