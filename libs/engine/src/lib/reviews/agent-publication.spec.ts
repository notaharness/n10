import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReviewSubmission, LedgerStore } from '@n10/vcs-core';
import { freshLedger, ReviewPublishError } from '@n10/vcs-core';
import {
  appendComment,
  readComments,
  type ReviewComment,
} from '@n10/review-comments';
import { reviewReadFixture } from './review-read-fixture.js';
import { createAgentComments } from './agent-comments.js';

const env = vi.hoisted(() => ({ home: '', viewer: 'alice' }));
vi.mock('node:os', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  homedir: () => env.home,
}));
vi.mock('@n10/core', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  agentCommentRepository: () => '/repo/.git',
}));
const head = 'a'.repeat(40);
const comment: ReviewComment = {
  id: 'one',
  file: 'a.ts',
  lineStart: 2,
  lineEnd: 4,
  side: 'LEFT',
  severity: 'major',
  body: 'Check the bounds.',
  status: 'draft',
  createdAt: '2026-01-01',
};
const closed: (() => void)[] = [];
beforeEach(() => {
  env.home = mkdtempSync(join(tmpdir(), 'n10-agent-publication-'));
  env.viewer = 'alice';
});
afterEach(() => {
  for (const close of closed.splice(0)) close();
  rmSync(env.home, { recursive: true, force: true });
});
function setup() {
  const publish = vi.fn<
    (
      submission: ReviewSubmission,
      ledger: LedgerStore
    ) => Promise<{
      reviewId: string;
      items: Record<string, string>;
      resumed: null;
    }>
  >(async (submission) => ({
    reviewId: 'review',
    items: Object.fromEntries(
      submission.items.map((item) => [item.key, 'remote'])
    ),
    resumed: null,
  }));
  const fixture = reviewReadFixture(() => ({
    config: { vendorAuth: { token: 't' }, vendorProject: { repo: 'app' } },
    repository: {
      provider: 'github',
      host: 'github.com',
      repository: 'owner/app',
    },
    viewer: env.viewer,
    vcsConfigured: true,
    provider: {
      id: 'github',
      publishReview: (
        _auth: unknown,
        _project: unknown,
        submission: ReviewSubmission,
        ledger: LedgerStore
      ) => publish(submission, ledger),
    },
  }));
  const changed = vi.fn();
  const service = createAgentComments(fixture.options, changed);
  closed.push(() => service.dispose());
  appendComment('/repo/.git', 7, comment);
  return { service, publish, changed };
}
it('publishes signed findings through the configured publisher with the exact side, range and head', async () => {
  const f = setup();
  expect(await f.service.post({ prId: 7, headSha: head })).toBe(1);
  expect(f.publish).toHaveBeenCalledWith(
    expect.objectContaining({
      head,
      event: 'COMMENT',
      items: [
        expect.objectContaining({
          body: expect.stringContaining('Check the bounds.'),
          place: {
            kind: 'line',
            path: 'a.ts',
            range: { start: 2, end: 4, side: 'LEFT', startSide: 'LEFT' },
          },
        }),
      ],
    }),
    expect.objectContaining({
      read: expect.any(Function),
      write: expect.any(Function),
    })
  );
  expect(readComments('/repo/.git', 7)[0].status).toBe('posted');
  expect(f.changed).toHaveBeenCalled();
});
it('resumes an unanswered publication with its durable ledger and refuses editing or another account', async () => {
  const f = setup();
  f.publish.mockImplementationOnce(async (_submission, ledger) => {
    ledger.write({ ...freshLedger(head), inFlight: 'review' });
    throw new Error('Lost response');
  });
  await expect(f.service.post({ prId: 7, headSha: head })).rejects.toThrow(
    'Lost response'
  );
  expect(() => f.service.update(7, 'one', { body: 'changed' })).toThrow(
    'may already be posted'
  );
  env.viewer = 'bob';
  await expect(f.service.post({ prId: 7, headSha: head })).rejects.toThrow(
    'account and repository'
  );
  env.viewer = 'alice';
  f.publish.mockImplementationOnce(async (submission, ledger) => {
    expect(ledger.read()?.inFlight).toBe('review');
    return {
      reviewId: 'review',
      items: { [submission.items[0].key]: 'remote' },
      resumed: null,
    };
  });
  expect(await f.service.post({ prId: 7, headSha: head })).toBe(1);
  expect(readComments('/repo/.git', 7)[0].status).toBe('posted');
});
it('keeps completed comments posted when a later comment fails, and applies a verdict once', async () => {
  const f = setup();
  appendComment('/repo/.git', 7, { ...comment, id: 'two' });
  f.publish
    .mockImplementationOnce(async (submission) => ({
      reviewId: 'r',
      items: { [submission.items[0].key]: 'first' },
      resumed: null,
    }))
    .mockRejectedValueOnce(new Error('Refused'));
  await expect(
    f.service.post({ prId: 7, headSha: head, event: 'APPROVE' })
  ).rejects.toThrow('Refused');
  expect(readComments('/repo/.git', 7).map((item) => item.status)).toEqual([
    'posted',
    'draft',
  ]);
  expect(f.publish.mock.calls.map(([submission]) => submission.event)).toEqual([
    'APPROVE',
    'COMMENT',
  ]);
});
it('validates head and empty findings before publishing', async () => {
  const f = setup();
  await expect(f.service.post({ prId: 7 })).rejects.toThrow(
    'Refresh pull requests'
  );
  f.service.update(7, 'one', { body: '' });
  await expect(f.service.post({ prId: 7, headSha: head })).rejects.toThrow(
    'empty body'
  );
  expect(f.publish).not.toHaveBeenCalled();
});

it('normalizes edited bodies while allowing an explicit severity-only change', () => {
  const f = setup();
  f.service.update(7, 'one', {
    body: 'question (blocking): does this drop writes?',
  });
  expect(f.service.read(7)[0].severity).toBe('critical');
  f.service.update(7, 'one', { severity: 'minor' });
  expect(f.service.read(7)[0].severity).toBe('minor');
  f.service.remove(7, 'one');
  expect(f.service.read(7)).toEqual([]);
});
it('keeps posted comments immutable and refuses missing draft ids', async () => {
  const f = setup();
  await f.service.post({ prId: 7, headSha: head });
  expect(() => f.service.update(7, 'one', { body: 'changed' })).toThrow(
    'already posted'
  );
  expect(() => f.service.remove(7, 'missing')).toThrow('no longer exists');
});

it('keeps a finding unsent when a resumed review does not contain it', async () => {
  const f = setup();
  f.publish.mockResolvedValueOnce({ reviewId: 'r', items: {}, resumed: null });
  await expect(f.service.post({ prId: 7, headSha: head })).rejects.toThrow(
    'did not confirm'
  );
  expect(f.service.read(7)[0].status).toBe('draft');
});

it('observes external agent writes only while subscribed', async () => {
  const f = setup();
  const resource = f.service.resource(7);
  const listener = vi.fn();
  const off = resource.subscribe(listener);
  await resource.read();
  appendComment('/repo/.git', 7, { ...comment, id: 'external' });
  await vi.waitFor(() => expect(resource.getSnapshot().data).toHaveLength(2));
  off();
  listener.mockClear();
  appendComment('/repo/.git', 7, { ...comment, id: 'after-close' });
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(listener).not.toHaveBeenCalled();
});

it('keeps a comment posted when the publisher confirms it before a later failure', async () => {
  const f = setup();
  f.publish.mockImplementationOnce(async (submission) => {
    throw new ReviewPublishError('refused', 'Vote refused', {
      posted: { [submission.items[0].key]: 'azure-thread' },
    });
  });
  await expect(
    f.service.post({ prId: 7, headSha: head, event: 'APPROVE' })
  ).rejects.toThrow('Vote refused');
  expect(f.service.read(7)[0].status).toBe('posted');
  expect(() => f.service.update(7, 'one', { body: 'retry' })).toThrow(
    'already posted'
  );
});
