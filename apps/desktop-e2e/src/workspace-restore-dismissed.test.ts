import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect } from './fixtures/desktop.js';
import { tab } from './setup/app.js';
import { cleanupExternalSessions, tmuxAvailable } from './setup/external.js';
import { cleanupTestRepo, createTestRepo } from './setup/git-repo.js';
import { letHostTimePass } from './setup/host-time.js';
import { findN10SessionFor, killTmuxSession } from './setup/tmux.js';

/**
 * Closing another repository's agent leaves it running, so its tab must
 * stay closed: through the polls that list it, and through a restart,
 * since the dismissal is saved with the workspace. Once tmux no longer
 * runs it, the dismissal goes.
 */
const OWN = 'e2e-ext-own-dismissed';
const FOREIGN = 'e2e-ext-foreign-dismissed';

const agentCommand = (banner: string) => `printf '%s\\n' ${banner}; sleep 300`;

const test = base.extend<{ other: string }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture signature
  other: async ({}, provide) => {
    const dir = createTestRepo({ name: 'repo-other' });
    await provide(dir);
    cleanupTestRepo(dir);
  },
  liveSessions: async ({ other }, provide) => {
    await provide([
      { branch: OWN, command: agentCommand('own-agent-here') },
      {
        branch: FOREIGN,
        command: agentCommand('foreign-agent-here'),
        repo: other,
      },
    ]);
  },
});

test.skip(!tmuxAvailable(), 'tmux is not installed');

test.afterEach(({ desktop, other }) => {
  cleanupExternalSessions(desktop.repoPath, [OWN], desktop.homeDir);
  cleanupExternalSessions(other, [FOREIGN], desktop.homeDir);
});

/** The dismissals in the saved file. */
function dismissed(homeDir: string): string[] | null {
  try {
    const file = JSON.parse(
      readFileSync(join(homeDir, '.n10', 'workspace.json'), 'utf8')
    ) as { workspace: { dismissed?: string[] } };
    return file.workspace.dismissed ?? [];
  } catch {
    return null;
  }
}

test('a closed agent of another repository stays closed across a restart, until it ends', async ({
  desktop,
}) => {
  const { page, homeDir } = desktop;
  const foreign = (p = page) => tab(p, new RegExp(FOREIGN));
  await expect(foreign()).toBeVisible({ timeout: 30_000 });
  await foreign().getByRole('button', { name: 'Close tab' }).click();
  await expect(foreign()).toHaveCount(0);
  await expect.poll(() => dismissed(homeDir)?.length).toBe(1);

  await desktop.relaunch();
  const next = desktop.page;
  // The open repository's agent is back, and the host lists the other
  // one as alive; a few of the strip's polls later, it is still closed.
  await expect(tab(next, new RegExp(OWN))).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      () =>
        next.evaluate(async () => {
          const answer = await window.n10.listForeignSessions();
          return answer.sessions.map((s) => s.branch);
        }),
      { timeout: 30_000 }
    )
    .toContain(FOREIGN);
  await letHostTimePass(next, 9_000);
  await expect(foreign(next)).toHaveCount(0);
  expect(dismissed(homeDir)).toHaveLength(1);

  // Ended: tmux no longer runs it, and the dismissal is forgotten.
  const session = findN10SessionFor(FOREIGN, homeDir);
  expect(session).toBeTruthy();
  killTmuxSession(session!, homeDir);
  await expect
    .poll(() => dismissed(homeDir)?.length, { timeout: 30_000 })
    .toBe(0);
});
