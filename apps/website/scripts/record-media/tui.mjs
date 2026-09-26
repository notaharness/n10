// The terminal UI clip: the real `n10 --tui`, built from apps/cli, on a
// PTY served by apps/cli-wterm-host (the bridge cli-e2e drives) against
// the README demo's staged repository and fake `gh`
// (apps/desktop-e2e/demo/scenario.mjs). It is filmed in real time: the
// TUI is another process, so the page's clock is not ours to stop.
//
// tmux: the host pins TMUX_TMPDIR to the scenario's HOME and drops TMUX,
// so every session lands on a scratch server there. Teardown kills that
// server's sessions one by one, never the server itself.
import { execFileSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const HOST = join(ROOT, 'apps/cli-wterm-host/dist/main.js');
// Loaded by path, like the host binary above: this is desktop-e2e's
// tooling, run from here, not a module the website builds against.
const SCENARIO = join(ROOT, 'apps/desktop-e2e/demo/scenario.mjs');
const PORT = 5179;
const ORIGIN = `http://localhost:${PORT}`;

/** The desktop's own terminal colours: wterm's default and `theme-light`
 *  palettes on the app's pane backgrounds (apps/desktop/src/renderer/styles.css). */
const THEME_CSS = {
  dark: `html, body { background: #1f1f1f; }
    #wterm-root { --term-bg: #1f1f1f; }`,
  light: `html, body { background: #ffffff; }
    #wterm-root { --term-bg: #ffffff; }`,
};
const GRID_CSS = `#wterm-root { --term-font-size: 15px; --term-row-height: 19px; padding: 10px 14px; box-sizing: border-box; }`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startHost() {
  const host = spawn('node', [HOST], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 100; i += 1) {
    try {
      await fetch(ORIGIN, { method: 'HEAD' });
      return host;
    } catch {
      await sleep(100);
    }
  }
  host.kill('SIGTERM');
  throw new Error(
    'wterm host did not come up; run `npx nx build cli-wterm-host`'
  );
}

/** The scratch tmux server's environment, proven to be the scenario's. */
function scratchTmux(home) {
  if (
    resolve(dirname(home)) !== resolve(tmpdir()) ||
    !basename(home).startsWith('n10-demo-home-')
  ) {
    throw new Error(`${home} is not a scenario HOME; refusing to touch tmux`);
  }
  const env = { ...process.env, TMUX_TMPDIR: home };
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

function killScratchSessions(home) {
  const env = scratchTmux(home);
  let names = [];
  try {
    names = execFileSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return; // no server was started
  }
  for (const name of names) {
    execFileSync('tmux', ['kill-session', '-t', `=${name}`], {
      env,
      stdio: 'ignore',
    });
  }
}

/** Reading the review threads on a pull request, planning one with a
 *  note and handing the plan to an agent in the branch's worktree. */
async function take(d, page) {
  const term = (text) => page.getByText(text);
  await d.hold(1000);
  // Walk to the top, where the selection clamps, then count down: the
  // first key can land before Ink listens (see the demo's README).
  for (const key of ['ArrowDown', 'ArrowDown', 'ArrowDown', 'ArrowDown']) {
    await d.press(key);
    await d.hold(550);
  }
  for (let i = 0; i < 6; i += 1) await d.press('ArrowUp');
  await d.hold(400);
  await d.press('ArrowDown');
  await d.hold(800);
  await d.press('d');
  await d.until(term(/keyboard\.ts/));
  await d.hold(900);
  await d.press('Enter');
  await d.hold(1000);
  await d.press('ArrowRight');
  await d.hold(1100);
  await d.press('Shift+ArrowDown');
  await d.until(term(/registry grows per plugin/));
  await d.hold(1200);
  await d.press('A');
  await d.hold(500);
  await d.type('Cache per query prefix so backspace is free.');
  await d.hold(600);
  await d.press('Enter');
  await d.until(term(/Added to plan|Plan/));
  await d.hold(800);
  await d.press('c');
  await d.until(term(/Plan Checkout/));
  d.poster();
  await d.hold(2000);
  await d.press('Enter');
  await d.until(term(/connected to workspace/), 15);
  await d.until(term(/Editing/), 40);
  await d.hold(2200);
}

/** Records the tui clip in `theme` into `frames`; returns the Director. */
export async function recordTui(browser, theme, makeDirector) {
  const { buildScenario } = await import(pathToFileURL(SCENARIO).href);
  const scenario = buildScenario();
  const host = await startHost();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  try {
    const res = await fetch(`${ORIGIN}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoPath: scenario.repo,
        homeDir: scenario.home,
        cols: 120,
        rows: 40,
        env: { ...scenario.env, TMUX_TMPDIR: scenario.home },
      }),
    });
    if (!res.ok) throw new Error(`/spawn failed: ${res.status}`);
    await page.goto(ORIGIN);
    await page.addStyleTag({ content: THEME_CSS[theme] + GRID_CSS });
    if (theme === 'light') {
      await page.locator('#wterm-root').evaluate((el) => {
        el.classList.add('theme-light');
      });
    }
    await page.getByText('n10').first().waitFor({ timeout: 30_000 });
    await sleep(1500);
    const d = makeDirector(page, { realtime: true });
    await take(d, page);
    return d;
  } finally {
    await page.close();
    await fetch(`${ORIGIN}/kill`, { method: 'POST' }).catch(() => undefined);
    host.kill('SIGTERM');
    killScratchSessions(scenario.home);
    rmSync(scenario.home, { recursive: true, force: true });
    rmSync(dirname(scenario.repo), { recursive: true, force: true });
  }
}
