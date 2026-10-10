import { test, expect, fakeAgentCommand } from './fixtures/n10.js';
import { createSession } from './setup/sessions.js';
import { n10SessionExists, uniqueTmuxBranch } from './setup/tmux.js';

for (const legacyBackend of [undefined, 'pty']) {
  test.describe(`tmux when installed (stored backend: ${
    legacyBackend ?? 'absent'
  })`, () => {
    test.use({
      n10Config: {
        agentId: 'test',
        aiCommand: fakeAgentCommand({ silent: true }),
        terminalBackend: legacyBackend,
      },
    });

    test('launches an agent in tmux @tmux', async ({ n10 }) => {
      const branch = uniqueTmuxBranch();
      await createSession(n10.term, branch, { start: true });
      await expect(
        n10.term.getByText('n10-fake-agent-ready').first()
      ).toBeVisible({ timeout: 20_000 });
      expect(n10SessionExists(branch, n10.homeDir)).toBe(true);
    });
  });
}
