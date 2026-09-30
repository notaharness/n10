import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The drafts bridge's own jobs: parse what the renderer sends as
 * untrusted, key the store by the configured account, and answer only
 * for the repository that is open. Core's store runs for real, under a
 * scratch HOME.
 */

const REF = {
  provider: 'github',
  host: 'github.com',
  repository: 'acme/app',
  number: 42,
};
const REPLY = { kind: 'reply', threadId: 'T-1' };

const env = vi.hoisted(() => ({ open: true, username: 'bea' }));

vi.mock('@n10/vcs-core', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  configuredRepository: () => ({
    provider: 'github',
    host: 'github.com',
    repository: 'acme/app',
  }),
  readConfig: () => ({
    vendor: 'github',
    vendorProject: { owner: 'acme', repo: 'app', username: env.username },
  }),
}));
vi.mock('./repo.js', () => ({
  requireRepo: () => '/repo',
  activeRepoIs: (cwd: string) => env.open && cwd === '/repo',
}));
// Only a submit resolves the provider; these tests never publish.

vi.mock('./program.js', () => ({
  resolveProvider: () => ({ config: {}, provider: null, configured: false }),
}));

const { discardDraft, listDrafts, saveDraft } = await import(
  './review-drafts.js'
);

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

  it('refuses a repository that is no longer open', async () => {
    env.open = false;
    await expect(listDrafts({ ref: REF, viewer: 'bea' })).rejects.toThrow(
      /no longer the repository open/
    );
  });

  it.each([
    ['no request', undefined],
    ['no viewer', { ref: REF }],
    ['a bad ref', { ref: { ...REF, number: -1 }, viewer: 'bea' }],
  ])('refuses %s', async (_, request) => {
    await expect(listDrafts(request)).rejects.toThrow(TypeError);
  });

  it('refuses a save with no target', async () => {
    await expect(
      saveDraft({ ref: REF, viewer: 'bea', body: 'x' })
    ).rejects.toThrow(/Invalid draft target/);
  });
});
