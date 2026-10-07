import { agentDraftDirectory } from '../setup/agent-drafts.js';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fakeGhProjectConfig,
  installFakeGh,
  type FakeGitHub,
} from '../setup/fake-gh.js';
import {
  fakeAdoProjectConfig,
  installFakeAdo,
  type FakeAzureDevOps,
} from '../setup/fake-ado.js';
import {
  addExternalWorktree,
  startExternalTmuxSession,
} from '../setup/external.js';
import {
  startSurvivingTerminal,
  type TerminalSeed,
} from '../setup/terminals.js';

/**
 * Everything a test wants already on disk (or already running) when the
 * app comes up. Split out of `desktop.ts` because it is the part that
 * grows: one more thing to seed is one more branch here, while the
 * fixture itself is about launching and tearing down the app.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_AGENT = join(HERE, 'fake-agent.mjs');

/**
 * `aiCommand` that spawns the fake agent.
 *
 *   fakeAgent()                 → alive but idle (no output after the banner)
 *   fakeAgent({ stream: true }) → continuously producing output
 */
export function fakeAgent(
  opts: {
    stream?: boolean;
    intervalMs?: number;
    exitAfterMs?: number;
    /** Echo stdin back, for testing the input round trip. */
    echo?: boolean;
    /** Print each stdin chunk as `key:<bytes>`, control bytes spelled out. */
    keys?: boolean;
    /** Stop streaming after this long, but stay alive. */
    streamMs?: number;
    /** Print the seed prompt the launcher handed it, `seed:`-prefixed. */
    printSeed?: boolean;
    /** Print the PTY grid as `size:<cols>x<rows>`, and again on resize. */
    printSize?: boolean;
    /** End each streamed line with `@<checkout directory>`. */
    tag?: boolean;
  } = {}
): string {
  const flags = [`--banner=n10-fake-agent-ready`];
  if (opts.stream) flags.push('--stream');
  if (opts.tag) flags.push('--tag');
  if (opts.echo) flags.push('--echo');
  if (opts.keys) flags.push('--keys');
  if (opts.printSeed) flags.push('--print-seed');
  if (opts.printSize) flags.push('--print-size');
  if (opts.streamMs != null) flags.push(`--stream-ms=${opts.streamMs}`);
  if (opts.intervalMs != null) flags.push(`--interval-ms=${opts.intervalMs}`);
  if (opts.exitAfterMs != null)
    flags.push(`--exit-after-ms=${opts.exitAfterMs}`);
  return ['node', FAKE_AGENT, ...flags].join(' ');
}

/** The seeding half of `DesktopOptions` — everything `seedHome` writes.
 *  `DesktopOptions` extends this, so the two never drift. */
export interface HomeSeed {
  /** Config layered over the fake agent in the isolated HOME. */
  n10Config?: Record<string, unknown>;
  /**
   * Per-project config (vendor, org, repo…), written to the cwd-hashed
   * path the config store reads it from. Needed for anything gated on a
   * configured provider — the settings page only lists a provider's
   * auth fields once one is selected.
   */
  projectConfig?: Record<string, unknown>;
  /** Written to $HOME/.n10/desktop-prefs.json before launch. */
  desktopPrefs?: Record<string, unknown>;
  /**
   * Agent-authored draft review comments, keyed by pull request id, as
   * `n10 util add-comment` would have left them.
   */
  drafts?: Record<number, unknown[]>;
  /**
   * Serve the app a pull request (and its review threads) from a fake
   * `gh` on PATH, with the matching project config written for it.
   * Lets the whole review workspace be driven offline; ignored when
   * `githubToken` is set, which is the real thing.
   */
  fakeGitHub?: FakeGitHub;
  /**
   * Serve the app Azure DevOps pull requests from a stand-in for its
   * REST API in the app's main process (`setup/fake-ado.ts`), with the
   * matching config written for it.
   */
  fakeAzureDevOps?: FakeAzureDevOps;
}

/**
 * Write the isolated `$HOME` a test runs against: global config, the
 * per-project config (cwd-hashed, as the config store keys it), any
 * agent-authored drafts, desktop prefs and — when a scenario is given —
 * the fake `gh`. Returns the environment additions the app needs.
 */
export function seedHome(
  homeDir: string,
  repoPath: string,
  opts: HomeSeed
): Record<string, string> {
  // The Azure DevOps fake's preload writes the only token, so an app it
  // is not in has none; one seeded here would undo that.
  const auth = opts.n10Config?.vendorAuth as
    | Record<string, unknown>
    | undefined;
  if (opts.fakeAzureDevOps && auth?.['azure-devops']) {
    throw new Error('fakeAzureDevOps brings its own token; seed none');
  }
  const n10 = join(homeDir, '.n10');
  mkdirSync(n10, { recursive: true });
  // A terminal tab runs the developer's login shell in this home. zsh
  // greets a home with no rc file with its first-user wizard, which
  // swallows whatever a test types next; an empty one means "configured,
  // nothing to do" and the shell comes up at a prompt.
  writeFileSync(join(homeDir, '.zshrc'), '', 'utf8');
  writeFileSync(
    join(n10, 'config.json'),
    JSON.stringify(
      {
        agentId: 'test',
        aiCommand: fakeAgent(),
        ...opts.n10Config,
      },
      null,
      2
    ),
    'utf8'
  );

  seedProjectConfig(n10, repoPath, opts);
  seedDrafts(n10, repoPath, opts.drafts);

  if (opts.desktopPrefs) {
    writeFileSync(
      join(n10, 'desktop-prefs.json'),
      JSON.stringify(opts.desktopPrefs, null, 2),
      'utf8'
    );
  }

  return {
    ...(opts.fakeGitHub ? installFakeGh(homeDir, opts.fakeGitHub) : {}),
    ...(opts.fakeAzureDevOps
      ? installFakeAdo(homeDir, opts.fakeAzureDevOps)
      : {}),
  };
}

function seedProjectConfig(
  n10: string,
  repoPath: string,
  opts: Pick<HomeSeed, 'projectConfig' | 'fakeGitHub' | 'fakeAzureDevOps'>
): void {
  const projectConfig =
    opts.projectConfig ??
    (opts.fakeGitHub ? fakeGhProjectConfig(opts.fakeGitHub) : undefined) ??
    (opts.fakeAzureDevOps
      ? fakeAdoProjectConfig(opts.fakeAzureDevOps)
      : undefined);
  if (!projectConfig) return;
  // Per-project config lives under a hash of the repo path — see
  // projectKey() in @n10/vcs-core's config store.
  const key = createHash('sha256').update(repoPath).digest('hex').slice(0, 16);
  const dir = join(n10, 'projects', key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify(projectConfig, null, 2),
    'utf8'
  );
}

function seedDrafts(
  n10: string,
  repoPath: string,
  drafts: Record<number, unknown[]> | undefined
): void {
  for (const [prId, comments] of Object.entries(drafts ?? {})) {
    const dir = agentDraftDirectory(dirname(n10), repoPath, Number(prId));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'comments.json'),
      JSON.stringify({ prId: Number(prId), comments }, null, 2),
      'utf8'
    );
  }
}

/** Start the agents and terminal tabs a test wants already running when
 *  the app comes up — agents in the test's repository, or in another one
 *  a test names; terminals wherever they say. */
/** An agent session alive in tmux before the app starts. */
export interface LiveSessionSeed {
  branch: string;
  command: string;
  repo?: string;
  /** Check this new branch out in the worktree once the agent runs —
   *  the state a restart finds after `git switch` inside it. */
  switchTo?: string;
}

export function seedTmux(
  repoPath: string,
  homeDir: string,
  sessions: LiveSessionSeed[] | undefined,
  terminals: Record<string, TerminalSeed> | undefined
): void {
  for (const seed of sessions ?? []) {
    const repo = seed.repo ?? repoPath;
    const worktreePath = addExternalWorktree(repo, seed.branch);
    startExternalTmuxSession({
      repoPath: repo,
      homeDir,
      branch: seed.branch,
      worktreePath,
      command: seed.command,
    });
    if (seed.switchTo) {
      execFileSync('git', ['switch', '-c', seed.switchTo], {
        cwd: worktreePath,
        stdio: 'ignore',
      });
    }
  }
  for (const [name, t] of Object.entries(terminals ?? {})) {
    startSurvivingTerminal({ name, ...t, homeDir });
  }
}
