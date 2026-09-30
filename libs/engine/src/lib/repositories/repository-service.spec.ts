import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type * as Os from 'node:os';
import { readConfig, writeGlobalConfig } from '@n10/vcs-core';
import type { VcsProvider } from '@n10/vcs-core';
import { createRepositoryService } from './repository-service.js';

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
    credentialsChanged: vi.fn(),
    read: vi.fn(async () => ({})),
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

  it('shares a handle for aliases and replaces it on repository selection', () => {
    const cwd = repo('canonical');
    const link = join(fixture.home, 'alias');
    symlinkSync(cwd, link);
    const { service } = harness([]);
    const current = service.open(link);
    expect(current.cwd).toBe(cwd);
    expect(service.open(cwd)).toBe(current);
    const dispose = vi.spyOn(current.worktrees, 'dispose');
    const next = service.open(repo('another'));
    expect(dispose).toHaveBeenCalledOnce();
    expect(next).not.toBe(current);
    expect(next.config).not.toBe(current.config);
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
