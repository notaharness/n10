import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { useReviewComments } from '@n10/app-core';
import { appendComment } from '@n10/review-comments';

/**
 * The drafts the TUI's diff viewer shows while a review agent works.
 * Opening a PR before the agent has written anything is the usual
 * case, and the first draft it writes has to appear without the view
 * being reopened.
 */

// The store resolves ~/.n10 when it is first imported, so the fixture
// HOME has to exist before any import runs.
const fixture = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs');
  const tmp = process.env.TMPDIR ?? '/tmp';
  return { home: mkdtempSync(`${tmp}/n10-review-comments-hook-`) };
});
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  homedir: () => fixture.home,
}));

afterAll(() => rmSync(fixture.home, { recursive: true, force: true }));

const scope = { repo: '0123456789abcdef', prId: 7 };

function Drafts() {
  const ids = useReviewComments(scope).map((c) => c.id);
  return <Text>ids:[{ids.join(',')}]</Text>;
}

async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!done() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('useReviewComments', () => {
  it('shows the first draft written after the PR was opened', async () => {
    const { lastFrame, unmount } = render(<Drafts />);
    try {
      expect(lastFrame()).toContain('ids:[]');
      appendComment(scope, {
        id: 'first',
        file: 'a.ts',
        lineStart: 1,
        lineEnd: 1,
        severity: 'major',
        body: 'issue: this leaks',
        side: 'RIGHT',
        status: 'draft',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await until(() => lastFrame()?.includes('ids:[first]') ?? false);
      expect(lastFrame()).toContain('ids:[first]');
    } finally {
      unmount();
    }
  });
});
