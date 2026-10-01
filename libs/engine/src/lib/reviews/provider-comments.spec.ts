import * as vcs from '@n10/vcs-core';
import { expect, it, vi } from 'vitest';
import { reviewReadFixture } from './review-read-fixture.js';
import { readResourceValue } from './read-resource.js';
import { createReviewService } from './review-service.js';
import type { WorktreeService } from '../worktrees/api.js';

it.each(['7 OR 1=1', '../../admin', 2.5, 0, -1])(
  'rejects invalid PR identity %s before provider work',
  (id) => {
    const { service } = reviewReadFixture(() => ({}));
    expect(() => service.comments(id as number)).toThrow('Invalid PR id');
    expect(() => service.description(id as number)).toThrow('Invalid PR id');
  }
);

it('returns empty decorations for an unconfigured repository and reports missing comment capability', async () => {
  let configured = false;
  const { service } = reviewReadFixture(() => ({
    vcsConfigured: configured,
    provider: { id: 'github' },
  }));
  expect(await readResourceValue(service.comments(1))).toEqual({
    threads: [],
    generalComments: [],
  });
  expect(await readResourceValue(service.description(1))).toBe('');
  configured = true;
  service.reset();
  await expect(readResourceValue(service.comments(1))).rejects.toThrow(
    'does not support comments'
  );
  expect(await readResourceValue(service.description(1))).toBe('');
});

it('captures credentials and preserves the last successful threads on provider failure', async () => {
  const comments = { threads: [], generalComments: [] };
  const fetchCommentThreads = vi
    .fn()
    .mockResolvedValueOnce(comments)
    .mockRejectedValue(new Error('Offline'));
  const { service } = reviewReadFixture(() => ({
    vcsConfigured: true,
    provider: { id: 'github', fetchCommentThreads },
    config: { vendorAuth: { token: 'tok' }, vendorProject: { repo: 'n10' } },
  }));
  const resource = service.comments(7);
  expect(await readResourceValue(resource)).toBe(comments);
  expect(fetchCommentThreads).toHaveBeenCalledWith(
    { token: 'tok' },
    { repo: 'n10' },
    7
  );
  expect(await resource.read(true)).toMatchObject({
    data: comments,
    error: 'Offline',
  });
});

it('invalidates on account changes including Azure email and rejects answers from an obsolete account', async () => {
  let viewer = 'first@example.test';
  let release!: (value: { threads: never[]; generalComments: never[] }) => void;
  const pending = new Promise<{ threads: never[]; generalComments: never[] }>(
    (resolve) => {
      release = resolve;
    }
  );
  const fetchCommentThreads = vi
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValue({ threads: [], generalComments: [] });
  const fixture = reviewReadFixture(() => ({
    viewer,
    vcsConfigured: true,
    config: {
      vendor: 'azure-devops',
      email: viewer,
      vendorAuth: {},
      vendorProject: {},
    },
    provider: { id: 'azure-devops', fetchCommentThreads },
  }));
  const reviews = createReviewService({
    ...fixture.options,
    worktrees: { find: vi.fn() } as unknown as WorktreeService,
  });
  const resource = reviews.comments(1);
  const read = resource.read();
  await Promise.resolve();
  await Promise.resolve();
  viewer = 'second@example.test';
  fixture.changed();
  expect(resource.getSnapshot().data).toBeNull();
  release({ threads: [], generalComments: [] });
  await read;
  expect(fetchCommentThreads).toHaveBeenCalledTimes(2);
  reviews.dispose();
});

it('rejects a thread answer if the account changes during the read without a notification', async () => {
  let viewer = 'alice';
  const fixture = reviewReadFixture(() => ({
    viewer,
    vcsConfigured: true,
    provider: {
      id: 'github',
      fetchCommentThreads: async () => {
        viewer = 'bob';
        return { threads: [], generalComments: [] };
      },
    },
  }));
  await expect(readResourceValue(fixture.service.comments(1))).rejects.toThrow(
    'account or repository changed'
  );
});

it('expires review reads when list facts move, preserving rows and ignoring other repositories', async () => {
  const first = { threads: [], generalComments: [] };
  const fetchCommentThreads = vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockRejectedValue(new Error('Offline'));
  const fixture = reviewReadFixture(() => ({
    vcsConfigured: true,
    provider: { id: 'github', fetchCommentThreads },
  }));
  const reviews = createReviewService({
    ...fixture.options,
    worktrees: { find: vi.fn() } as unknown as WorktreeService,
  });
  const resource = reviews.comments(1);
  await resource.read();
  fixture.listChanged(
    { feature: { id: 1, headSha: 'new' } as never },
    '/other'
  );
  await resource.read();
  expect(fetchCommentThreads).toHaveBeenCalledOnce();
  fixture.listChanged({ feature: { id: 1, headSha: 'new' } as never });
  expect(resource.getSnapshot().data).toBe(first);
  expect(await resource.read()).toMatchObject({
    data: first,
    error: 'Offline',
  });
  expect(fetchCommentThreads).toHaveBeenCalledTimes(2);
  reviews.dispose();
});

it('rejects a disk identity change without publishing config effects from a query', async () => {
  const fetchCommentThreads = vi
    .fn()
    .mockResolvedValue({ threads: [], generalComments: [] });
  const fixture = reviewReadFixture(() => ({
    config: { vendorAuth: { token: 'first' } } as never,
    vcsConfigured: true,
    provider: { id: 'github', fetchCommentThreads },
  }));
  vi.mocked(vcs.readConfig).mockReturnValue({
    vendorAuth: { token: 'next' },
  } as never);
  await expect(readResourceValue(fixture.service.comments(7))).rejects.toThrow(
    'account or repository changed'
  );
  expect(fetchCommentThreads).not.toHaveBeenCalled();
  expect(fixture.options.config.reload).not.toHaveBeenCalled();
});
