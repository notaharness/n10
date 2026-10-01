import { expect, it, vi } from 'vitest';
import type { RemoteCommentThread } from '@n10/vcs-core';
import { reviewReadFixture } from './review-read-fixture.js';
import { createReviewCommands } from './review-commands.js';

const thread: RemoteCommentThread = {
  id: 'thread',
  file: 'a.ts',
  lineStart: 1,
  lineEnd: 1,
  side: 'RIGHT',
  isResolved: false,
  isOutdated: false,
  canResolve: true,
  comments: [],
};
function fixture() {
  let open = true;
  const provider = {
    id: 'github',
    fetchCommentThreads: vi
      .fn()
      .mockResolvedValue({ threads: [thread], generalComments: [] }),
    replyToThread: vi.fn().mockResolvedValue({ id: 'reply', body: 'reply' }),
    setThreadResolved: vi.fn().mockResolvedValue(undefined),
    submitReviewVerdict: vi.fn().mockResolvedValue(undefined),
  };
  const read = reviewReadFixture(
    () => ({
      provider,
      vcsConfigured: true,
      viewer: 'reviewer',
      config: { vendorAuth: { token: 'tok' }, vendorProject: { repo: 'app' } },
    }),
    () => open
  );
  return {
    ...read,
    provider,
    close: () => {
      open = false;
    },
    commands: createReviewCommands(read.options, read.service),
  };
}
it('resolves a trusted thread, captures credentials and publishes the confirmed reply', async () => {
  const f = fixture();
  await f.commands.reply({ prId: 7, threadId: 'thread', body: 'reply' });
  expect(f.provider.replyToThread).toHaveBeenCalledWith(
    { token: 'tok' },
    { repo: 'app' },
    7,
    thread,
    'reply'
  );
  expect(f.service.comments(7).getSnapshot().data?.threads[0].comments).toEqual(
    [{ id: 'reply', body: 'reply' }]
  );
});
it('refuses a stale repository before issuing a thread mutation', async () => {
  const f = fixture();
  f.provider.fetchCommentThreads.mockImplementation(async () => {
    f.close();
    return { threads: [thread], generalComments: [] };
  });
  await expect(
    f.commands.reply({ prId: 7, threadId: 'thread', body: 'reply' })
  ).rejects.toThrow('no longer open');
  expect(f.provider.replyToThread).not.toHaveBeenCalled();
});
it('refuses a thread that the selected pull request does not contain', async () => {
  const f = fixture();
  await expect(
    f.commands.reply({ prId: 7, threadId: 'other', body: 'reply' })
  ).rejects.toThrow('no longer exists');
  expect(f.provider.replyToThread).not.toHaveBeenCalled();
});
it('updates resolution and refreshes the captured repository list', async () => {
  const f = fixture();
  expect(
    await f.commands.resolve({ prId: 7, threadId: 'thread', resolved: true })
  ).toBe(true);
  expect(f.service.comments(7).getSnapshot().data?.threads[0].isResolved).toBe(
    true
  );
  expect(f.options.pullRequests.read).toHaveBeenCalledWith('/repo', {
    force: true,
  });
});
it('retains the thread when its mutation fails and does not refresh the list', async () => {
  const f = fixture();
  f.provider.setThreadResolved.mockRejectedValue(new Error('Rejected'));
  await expect(
    f.commands.resolve({ prId: 7, threadId: 'thread', resolved: true })
  ).rejects.toThrow('Rejected');
  expect(f.service.comments(7).getSnapshot().data?.threads[0].isResolved).toBe(
    false
  );
  expect(f.options.pullRequests.read).not.toHaveBeenCalled();
});
it.each([-1, 0, 1.5, 'other/repo'])(
  'refuses invalid PR id %s before writing',
  async (prId) => {
    const f = fixture();
    await expect(f.commands.verdict(prId as number, 'approve')).rejects.toThrow(
      'Invalid PR id'
    );
    expect(f.provider.submitReviewVerdict).not.toHaveBeenCalled();
  }
);
it('supports the review verdicts and rejects unknown verdicts', async () => {
  const f = fixture();
  for (const verdict of [
    'approve',
    'approve-with-suggestions',
    'wait-for-author',
    'reject',
  ] as const)
    await f.commands.verdict(7, verdict);
  expect(f.provider.submitReviewVerdict).toHaveBeenCalledTimes(4);
  await expect(f.commands.verdict(7, 'merge' as never)).rejects.toThrow(
    'Invalid review verdict'
  );
  expect(f.provider.submitReviewVerdict).toHaveBeenCalledTimes(4);
});

it('rechecks scope after awaiting an already cached thread', async () => {
  const f = fixture();
  await f.service.comments(7).read();
  const reply = f.commands.reply({
    prId: 7,
    threadId: 'thread',
    body: 'reply',
  });
  f.close();
  await expect(reply).rejects.toThrow('no longer open');
  expect(f.provider.replyToThread).not.toHaveBeenCalled();
});
