import {
  test,
  expect,
  fakeAgentCommand,
  type N10Term,
} from './fixtures/n10.js';
import { sidebarLocator } from './setup/sidebar.js';
import {
  createSession,
  tabIntoSession,
  waitForSidebarFocused,
} from './setup/sessions.js';

// Both sessions run the same fake-agent (aiCommand is global). We rely
// on the active→idle edge being detected after the 4s burst plus the
// 2s idle window, while we focus into the second session and let the
// first one transition behind us.
const aiCommand = fakeAgentCommand({ bursts: 1, burstMs: 4_000 });

/**
 * Session A ("busy") bursts then goes idle; session B ("second") is
 * where we wait, terminal-focused (escape only works from a focused
 * terminal). B exists before A starts, so leaving A mid-burst is one
 * `j` (sidebar order is alphabetical): creating B afterwards would show
 * A's terminal again while the worktree is made, and output on screen
 * is seen.
 */
async function startBusyThenSecond(term: N10Term): Promise<void> {
  await createSession(term, 'second');
  await createSession(term, 'busy', { start: true });
  await expect(term.getByText('n10-fake-agent-ready').first()).toBeVisible({
    timeout: 10_000,
  });
  await term.write('\x00');
  await waitForSidebarFocused(term);
  await term.type('j');
  await expect(sidebarLocator(term.page, 'second').selected()).toBeVisible({
    timeout: 5_000,
  });
  await tabIntoSession(term);
  await expect(term.getByText(/Agent.*second/).first()).toBeVisible({
    timeout: 10_000,
  });
}

test.describe('Activity queue (Ctrl+Space, setting on)', () => {
  test.use({
    n10Config: {
      aiCommand,
      autoHideSidebar: false,
      keybindPreset: 'vim',
    },
  });

  test('jumps to a queued idle session', async ({ n10 }) => {
    await startBusyThenSecond(n10.term);

    // Wait for the watcher to detect "busy" going idle and enqueue it.
    // The toast is the user-visible signal that the queue has an entry.
    await expect(n10.term.getByText('busy is idle')).toBeVisible({
      timeout: 12_000,
    });

    // Ctrl+Space from inside `second`'s terminal should pop the queue
    // and select `busy` (instead of returning to the sidebar).
    await n10.term.write('\x00');

    // Sidebar selection moved to `busy` (◉ ring icon in front of name).
    await expect(sidebarLocator(n10.term.page, 'busy').selected()).toBeVisible({
      timeout: 5_000,
    });
  });
});

test.describe('Activity queue (Ctrl+Space, setting off)', () => {
  test.use({
    n10Config: {
      aiCommand,
      autoHideSidebar: false,
      jumpToInactiveOnEscape: false,
      keybindPreset: 'vim',
    },
  });

  test('falls back to sidebar focus when setting is off', async ({ n10 }) => {
    await startBusyThenSecond(n10.term);

    // Toast still fires (toast is independent of the jump setting), so
    // we can use it as a synchronization point that the model has
    // observed busy → idle.
    await expect(n10.term.getByText('busy is idle')).toBeVisible({
      timeout: 12_000,
    });

    await n10.term.write('\x00');

    // With the setting off, Ctrl+Space should restore the original
    // behavior: focus the sidebar. Focus signal we can observe is that
    // the main pane no longer carries the "(ctrl+space to exit)" hint,
    // which getPaneTitle only appends when terminal-focused.
    await expect(n10.term.getByText(/ctrl\+space to exit/)).not.toBeVisible({
      timeout: 5_000,
    });
  });
});

// The default layout: the sidebar hides while a terminal is focused, so
// no sidebar row is mounted to acknowledge what the terminal shows. The
// agent echoes input after 2.5s, which puts each burst of output at a
// moment the test controls.
test.describe('Activity queue (auto-hidden sidebar)', () => {
  test.use({
    n10Config: {
      aiCommand: fakeAgentCommand({
        silent: true,
        echo: true,
        echoDelayMs: 2_500,
      }),
      keybindPreset: 'vim',
    },
  });

  test('does not queue output the user watched in the terminal', async ({
    n10,
  }) => {
    // 1. `queued` answers after we left it for `watched` (created first,
    //    so leaving is one `j`): its echo goes idle unseen and is
    //    queued. Text before Ctrl+Space in one write still reaches the
    //    agent.
    await createSession(n10.term, 'watched');
    await createSession(n10.term, 'queued', { start: true });
    await expect(
      n10.term.getByText('n10-fake-agent-ready').first()
    ).toBeVisible({ timeout: 10_000 });
    await n10.term.write('ping-queued\x00');
    await waitForSidebarFocused(n10.term);
    await n10.term.type('j');
    await expect(
      sidebarLocator(n10.term.page, 'watched').selected()
    ).toBeVisible({ timeout: 5_000 });
    await tabIntoSession(n10.term);
    await expect(n10.term.getByText(/Agent.*watched/).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(n10.term.getByText('queued is idle')).toBeVisible({
      timeout: 12_000,
    });

    // 2. `watched` answers on screen. Leaving the moment its echo shows
    //    pops the queue: focus lands in `queued`'s terminal, inside the
    //    2s before `watched` reads as idle.
    await n10.term.write('ping-watched');
    await expect(n10.term.getByText('ping-watched').first()).toBeVisible({
      timeout: 10_000,
    });
    await n10.term.write('\x00');
    await expect(
      n10.term.getByText(/Agent.*queued.*ctrl\+space to exit/).first()
    ).toBeVisible({ timeout: 5_000 });

    // 3. `queued`'s own echo takes 2.5s, so once it shows `watched` has
    //    gone idle. Its output was on screen, so it is not queued:
    //    Ctrl+Space falls back to the sidebar. Assert that positively —
    //    the sidebar only renders once focus leaves the terminal, while
    //    a jump to `watched` keeps it hidden. The pane title can drop
    //    its "(ctrl+space to exit)" hint for a frame mid-jump.
    await n10.term.write('ping-back');
    await expect(n10.term.getByText('ping-back').first()).toBeVisible({
      timeout: 10_000,
    });
    await n10.term.write('\x00');
    await expect(
      sidebarLocator(n10.term.page, 'queued').selected()
    ).toBeVisible({ timeout: 5_000 });
  });
});
