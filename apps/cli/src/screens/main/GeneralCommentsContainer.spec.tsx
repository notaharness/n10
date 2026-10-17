import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import type { DiffBundle, PaneModeValue, TerminalLayout } from '@n10/app-core';
import type { ReviewComment } from '@n10/review-comments';
import type { PullRequestInfo } from '@n10/vcs-core';
import { GeneralCommentsContainer } from './GeneralCommentsContainer.js';

const post = vi.fn<(req: unknown) => Promise<number>>(async () => 1);
const flashStatus = vi.fn();

vi.mock('@n10/app-core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEngine: () => ({ reviews: { agentComments: { post } } }),
  useAsyncOps: () => ({ run: (_key: string, op: () => Promise<void>) => op() }),
  useSessionActions: () => ({ flashStatus }),
}));

// Mouse tracking writes its own escape sequence as the last frame.
vi.mock('../../hooks/useScrollWheel.js', () => ({
  useScrollWheel: () => undefined,
}));

const finding = (id: string, file: string | null): ReviewComment => ({
  id,
  file,
  lineStart: file === null ? null : 3,
  lineEnd: file === null ? null : 3,
  side: 'RIGHT',
  severity: 'major',
  body: `${id} body`,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00Z',
});

const pr = { id: 42, headSha: 'a'.repeat(40) } as PullRequestInfo;

function renderPane(comments: ReviewComment[]) {
  const pane = {
    generalCommentsIndex: 0,
    generalCommentsScrollOffset: 0,
    setGeneralCommentsIndex: vi.fn(),
    setGeneralCommentsScrollOffset: vi.fn(),
    setPaneMode: vi.fn(),
    replyingToThreadId: null,
    replyBuffer: '',
  } as unknown as PaneModeValue;
  const diffBundle = {
    comments,
    remote: {
      generalComments: [],
      refresh: vi.fn(),
      toggleResolved: vi.fn(),
      replyToThread: vi.fn(),
    },
  } as unknown as DiffBundle;
  return render(
    <GeneralCommentsContainer
      pane={pane}
      terminal={{ paneRows: 30 } as TerminalLayout}
      terminalFocused={false}
      diffBundle={diffBundle}
      selectedPr={pr}
    />
  );
}

describe('GeneralCommentsContainer', () => {
  beforeEach(() => {
    post.mockClear();
    flashStatus.mockClear();
  });

  it('lists the agent’s findings on the pull request, not those on code', async () => {
    const { lastFrame } = renderPane([
      finding('on-pr', null),
      finding('on-code', 'a.ts'),
    ]);
    const frame = () => stripAnsi(lastFrame() ?? '');
    await vi.waitFor(() => expect(frame()).toContain('PR Comments (1)'));
    expect(frame()).toContain('on-pr body');
    expect(frame()).not.toContain('on-code body');
    expect(frame()).toContain('[p]ost');
    expect(frame()).not.toContain('[e]dit');
  });

  it('posts the selected finding at the head the sidebar read', async () => {
    const { stdin } = renderPane([finding('on-pr', null)]);
    stdin.write('p');
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith({
        prId: 42,
        ids: ['on-pr'],
        headSha: pr.headSha,
      })
    );
    await vi.waitFor(() =>
      expect(flashStatus).toHaveBeenCalledWith('Comment posted')
    );
  });
});
