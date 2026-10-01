import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { wtermHost } from './setup/constants.js';
import {
  createSession,
  pressUntil,
  waitForSidebarFocused,
} from './setup/sessions.js';
import { listTaggedSessions } from './setup/tmux.js';

// Regression for issue #56: 'q' must quit n10 while agents are running.
// Quitting detaches rather than kills, so every agent's tmux session
// keeps its original process for the next launch to reattach.
//
// The wterm host's `/status` reports whether n10's own PTY is still
// alive; the test's private tmux server shows what became of the agents.
test.use({
  n10Config: {
    agentId: 'test',
    aiCommand: fakeAgentCommand({
      bursts: 'inf',
      burstMs: 500,
      idleMs: 200,
    }),
    keybindPreset: 'vim',
  },
});

const BRANCHES = ['quit-a', 'quit-b'];

async function n10Running(host: string): Promise<boolean> {
  const r = await fetch(`${host}/status`);
  return ((await r.json()) as { ptyAlive: boolean }).ptyAlive;
}

/** The pane pid of `branch`'s agent while it runs: `undefined` for a
 *  missing session, a dead pane or the launch placeholder. */
function agentPid(branch: string, homeDir: string): number | undefined {
  const session = listTaggedSessions(homeDir).find(
    (s) => s.type === 'worktree' && s.branch === branch
  );
  if (!session || session.paneDead) return undefined;
  return session.paneStartCommand.includes('fake-agent')
    ? session.panePid
    : undefined;
}

test.describe('Quit with running agents (#56)', () => {
  test("'q' quits n10 and leaves every agent running in tmux", async ({
    n10,
    baseURL,
  }) => {
    const host = wtermHost(baseURL);
    const agentPids = () => BRANCHES.map((b) => agentPid(b, n10.homeDir));

    for (const branch of BRANCHES) {
      await createSession(n10.term, branch, { start: true });
      await expect
        .poll(() => agentPid(branch, n10.homeDir), { timeout: 20_000 })
        .toBeDefined();
      // Back to the sidebar, where 'c' creates and 'q' quits.
      await n10.term.write('\x00');
      await waitForSidebarFocused(n10.term);
    }
    const running = agentPids();
    expect(running).not.toContain(undefined);
    expect(await n10Running(host)).toBe(true);

    // Retried: a key right after Ctrl+Space can be dropped before the
    // sidebar's useInput is active. A quit that never exits still fails.
    await pressUntil(n10.term, 'q', async () => !(await n10Running(host)), {
      timeout: 10_000,
    });

    // Same live process in each session: detached, not killed or restarted.
    expect(agentPids()).toEqual(running);
  });
});
