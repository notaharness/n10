import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type * as Os from 'node:os';
import { readConfig, writeGlobalConfig } from '@n10/vcs-core';
import type { VcsProvider } from '@n10/vcs-core';
import { EMPTY_PULL_REQUEST_LIST } from '../pull-requests/api.js';
import type * as Reviews from '../reviews/api.js';
import { createReviewService } from '../reviews/api.js';
import {
  createRepositoryService,
  PARKED_REPOSITORY_TTL_MS,
} from './repository-service.js';

vi.mock('../reviews/api.js', async (original) => {
  const actual = await original<typeof Reviews>();
  return { ...actual, createReviewService: vi.fn(actual.createReviewService) };
});

const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => {
  const os = await original<typeof Os>();
  const fs = await import('node:fs');
  const path = await import('node:path');
  fixture.home = fs.mkdtempSync(path.join(os.tmpdir(), 'n10-repositories-'));
  return { ...os, homedir: () => fixture.home };
});
afterAll(() => rmSync(fixture.home, { recursive: true, force: true }));
beforeEach(() => writeGlobalConfig({}));

function repo(name: string): string {
  const cwd = join(fixture.home, name);
  mkdirSync(cwd, { recursive: true });
  execFileSync('git', ['init', '--quiet', cwd]);
  execFileSync('git', ['config', 'user.email', `${name}@test.invalid`], {
    cwd,
  });
  return cwd;
}

const providers: VcsProvider[] = [
  {
    id: 'github',
    displayName: 'GitHub',
    authFields: [],
    projectFields: [],
    matchesUser: () => false,
    fetchPullRequests: async () => ({}),
    getPullRequestUrl: () => '',
    parseRemoteUrl: (url: string) =>
      url.includes('github.com') ? { owner: 'acme', repo: 'app' } : null,
    isConfigured: () => true,
    repositoryRef: () => ({
      provider: 'github',
      host: 'github.com',
      repository: 'acme/app',
    }),
  },
];

function harness(registry = providers) {
  const pullRequests = {
    subscribe: () => () => undefined,
    getSnapshot: () => EMPTY_PULL_REQUEST_LIST,
    lookupPullRequest: vi.fn(async () => ({ kind: 'gone' as const })),
    credentialsChanged: vi.fn(),
    read: vi.fn(async () => ({})),
    refreshInBackground: vi.fn(),
  };
  const service = createRepositoryService({
    providers: registry,
    pullRequests,
  });
  return { service, pullRequests };
}

describe('repository scope', () => {
  it('opens a nested directory under the canonical Git root without changing cwd', () => {
    const original = process.cwd();
    const cwd = repo('detection');
    const nested = join(cwd, 'apps', 'cli');
    mkdirSync(nested, { recursive: true });
    execFileSync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/acme/app.git'],
      { cwd }
    );
    const { service } = harness();
    const current = service.open(nested);
    expect(current.cwd).toBe(cwd);
    expect(current.config.repo).toBe(cwd);
    expect(process.cwd()).toBe(original);
    expect(readConfig(cwd).email).toBe('detection@test.invalid');
    expect(current.config.getSnapshot().repository?.repository).toBe(
      'acme/app'
    );
    expect(current.config.getSnapshot().provider?.id).toBe('github');
  });

  it('shares a handle for aliases and parks it on repository selection', () => {
    const cwd = repo('canonical');
    const link = join(fixture.home, 'alias');
    symlinkSync(cwd, link);
    const { service } = harness([]);
    const current = service.open(link);
    expect(current.cwd).toBe(cwd);
    expect(service.open(cwd)).toBe(current);
    const park = vi.spyOn(current.sessions, 'park');
    const release = vi.spyOn(current.reviews, 'park');
    const next = service.open(repo('another'));
    expect(park).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
    expect(next).not.toBe(current);
    expect(next.config).not.toBe(current.config);
    expect(current.parked()).toBe(true);
    expect(next.parked()).toBe(false);
    // Selected again, the parked handle comes back with what it held.
    expect(service.open(cwd)).toBe(current);
    expect(current.parked()).toBe(false);
  });

  it('reads a repository without selecting it', () => {
    const { service } = harness([]);
    const selected = service.open(repo('selected'));
    const other = service.get(repo('read-only'));
    expect(service.getSnapshot()).toBe(selected);
    expect(other.parked()).toBe(true);
    expect(service.get(other.cwd)).toBe(other);
    expect(service.open(other.cwd)).toBe(other);
    expect(service.get(selected.cwd)).toBe(selected);
  });

  it('prewarms a parked repository’s rows, and its list with the parked max age', () => {
    const { service, pullRequests } = harness([]);
    const selected = service.open(repo('prewarm-selected'));
    const parked = service.get(repo('prewarm-parked'));
    const rows = vi.spyOn(parked.sessions, 'read');
    selected.prewarm();
    parked.prewarm();
    expect(pullRequests.refreshInBackground.mock.calls).toEqual([
      [selected.cwd, undefined],
      [parked.cwd, { maxAge: PARKED_REPOSITORY_TTL_MS }],
    ]);
    expect(rows).toHaveBeenCalledOnce();
  });

  it('keeps one visit record across repository switches', () => {
    const { service } = harness([]);
    service.open(repo('first'));
    service.open(repo('second'));
    service.open(repo('first'));
    const baselines = vi
      .mocked(createReviewService)
      .mock.calls.slice(-2)
      .map(([options]) => options.baselines);
    // A visit begun before a switch is the same visit after it.
    expect(new Set(baselines).size).toBe(1);
  });

  it('keeps the active scope when another checkout fails validation', () => {
    const { service } = harness([]);
    const current = service.open(repo('valid'));
    expect(() => service.open(join(fixture.home, 'missing'))).toThrow(
      'Not a git repository'
    );
    expect(service.getSnapshot()).toBe(current);
    expect(service.isActive(current.cwd)).toBe(true);
  });

  it('publishes config-derived identity and effects through one subscription', () => {
    const { service, pullRequests } = harness();
    const cwd = repo('identity');
    const current = service.open(cwd);
    const changed = vi.fn();
    current.config.subscribe(changed);
    current.config.updateField(
      { key: 'vendor', label: 'Provider', configBag: 'project' },
      'github'
    );
    current.config.updateField(
      { key: 'username', label: 'Username', configBag: 'vendorProject' },
      'bob'
    );
    expect(current.config.getSnapshot().viewer).toBe('bob');
    expect(current.config.getSnapshot().repository?.repository).toBe(
      'acme/app'
    );
    expect(changed).toHaveBeenCalledTimes(2);
    expect(current.config.getSnapshot().syncRevision).toBe(2);
    expect(pullRequests.credentialsChanged).toHaveBeenCalledTimes(2);
    expect(service.getSnapshot()).toBe(current);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('reloads same-repo detection through the existing config service', () => {
    const { service, pullRequests } = harness();
    const cwd = repo('redetection');
    const current = service.open(cwd);
    const changed = vi.fn();
    current.config.subscribe(changed);
    execFileSync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/acme/app.git'],
      { cwd }
    );
    expect(service.open(cwd)).toBe(current);
    expect(current.config.getSnapshot().provider?.id).toBe('github');
    expect(changed).toHaveBeenCalledOnce();
    expect(pullRequests.credentialsChanged).toHaveBeenCalledOnce();
  });
});
