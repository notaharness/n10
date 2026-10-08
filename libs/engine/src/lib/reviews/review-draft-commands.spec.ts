import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reviewReadFixture } from './review-read-fixture.js';
import { createReviewDraftCommands } from './review-draft-commands.js';

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};
const REPLY = { kind: 'reply', threadId: 'T-1' };

const env = vi.hoisted(() => ({ open: true, username: 'bea' }));

const fixture = reviewReadFixture(
  () => ({
    repository: {
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
    },
    viewer: env.username,
    vcsConfigured: false,
  }),
  () => env.open
);
const service = createReviewDraftCommands(fixture.options, vi.fn());
const { list: listDrafts, save: saveDraft, discard: discardDraft } = service;

let home: string;
const realHome = process.env['HOME'];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'n10-drafts-home-'));
  process.env['HOME'] = home;
  env.open = true;
  env.username = 'bea';
});
afterEach(() => {
  process.env['HOME'] = realHome;
  rmSync(home, { recursive: true, force: true });
});

describe('review drafts service', () => {
  it('saves, lists and discards as the configured account', async () => {
    const saved = await saveDraft({
      ref: REF,
      viewer: 'bea',
      target: REPLY,
      body: 'Line one\nLine two',
    });
    expect(saved).toMatchObject({
      id: 'reply:T-1',
      body: 'Line one\nLine two',
    });
    await expect(
      listDrafts({ ref: REF, viewer: 'bea' })
    ).resolves.toMatchObject({ viewer: 'bea', drafts: [{ id: 'reply:T-1' }] });
    await discardDraft({ ref: REF, viewer: 'bea', target: REPLY });
    await expect(
      listDrafts({ ref: REF, viewer: 'bea' })
    ).resolves.toMatchObject({ drafts: [] });
  });

  it('refuses a caller that last saw another account', async () => {
    await saveDraft({ ref: REF, viewer: 'bea', target: REPLY, body: 'mine' });
    env.username = 'carol';
    await expect(listDrafts({ ref: REF, viewer: 'bea' })).rejects.toThrow(
      /account changed from bea to carol/
    );
    await expect(
      listDrafts({ ref: REF, viewer: 'carol' })
    ).resolves.toMatchObject({ drafts: [] });
  });

  it('lists a parked repository’s drafts', async () => {
    await saveDraft({ ref: REF, viewer: 'bea', target: REPLY, body: 'mine' });
    env.open = false;
    await expect(
      listDrafts({ ref: REF, viewer: 'bea' })
    ).resolves.toMatchObject({ drafts: [{ body: 'mine' }] });
  });

  it.each([
    ['no request', undefined],
    ['no viewer', { ref: REF }],
    ['a bad ref', { ref: { ...REF, number: -1 }, viewer: 'bea' }],
  ])('refuses %s', async (_, request) => {
    await expect(listDrafts(request)).rejects.toThrow(TypeError);
  });

  it('reads the pull request list again after a submit, without waiting for it', async () => {
    const read = vi.mocked(fixture.options.pullRequests.read);
    read.mockClear();
    // A list read still out: the submit's answer does not wait on it.
    read.mockImplementationOnce(() => new Promise(() => undefined));
    await saveDraft({ ref: REF, viewer: 'bea', target: REPLY, body: 'x' });
    // No provider files reviews here, so the submit fails part-way, as
    // a publication can after posting some of it.
    await expect(
      service.submit({
        ref: REF,
        viewer: 'bea',
        head: 'a'.repeat(40),
        event: 'COMMENT',
        draftIds: ['reply:T-1'],
      })
    ).rejects.toThrow();
    expect(read).toHaveBeenCalledExactlyOnceWith('/repo', { force: true });
  });

  it('refuses a save with no target', async () => {
    await expect(
      saveDraft({ ref: REF, viewer: 'bea', body: 'x' })
    ).rejects.toThrow(/Invalid draft target/);
  });
});
