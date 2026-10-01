import { expect, it, vi } from 'vitest';
import type { RemoteCommentThread } from '@n10/vcs-core';

const commands = vi.hoisted(() => ({
  reply: vi.fn(),
  resolve: vi.fn(),
  verdict: vi.fn(),
  viewer: vi.fn(),
}));
vi.mock('./repo.js', () => ({ activeReviewService: () => ({ commands }) }));
const { replyToThread, setThreadResolved, submitReviewVerdict } = await import(
  './reviews.js'
);

it('forwards thread identity and user intent to the engine without trusting supplied thread metadata', async () => {
  const thread = { id: 'thread', file: 'untrusted.ts' } as RemoteCommentThread;
  await replyToThread({ prId: 7, thread, body: 'reply' });
  await setThreadResolved({ prId: 7, thread, resolved: true });
  await submitReviewVerdict(7, 'approve');
  expect(commands.reply).toHaveBeenCalledWith({
    prId: 7,
    threadId: 'thread',
    body: 'reply',
  });
  expect(commands.resolve).toHaveBeenCalledWith({
    prId: 7,
    threadId: 'thread',
    resolved: true,
  });
  expect(commands.verdict).toHaveBeenCalledWith(7, 'approve');
});
