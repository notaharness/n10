import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type * as Os from 'node:os';
import {
  readConfig,
  writeGlobalConfig,
  writeProjectConfig,
} from '@n10/vcs-core';
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

describe('repository scope', () => {
  it('detects the requested checkout without changing the process directory', () => {
    const original = process.cwd();
    const cwd = repo('detection');
    execFileSync(
      'git',
      ['remote', 'add', 'origin', 'https://github.com/acme/app.git'],
      { cwd }
    );
    const service = createRepositoryService(providers);
    const current = service.open(cwd);
    expect(process.cwd()).toBe(original);
    expect(readConfig(cwd).email).toBe('detection@test.invalid');
    expect(current.repository?.repository).toBe('acme/app');
    expect(current.providerId).toBe('github');
  });

  it('canonicalizes aliases and preserves snapshot identity on a no-op reopen', () => {
    const cwd = repo('canonical');
    const link = join(fixture.home, 'alias');
    symlinkSync(cwd, link);
    const service = createRepositoryService([]);
    const changed = vi.fn();
    const unsubscribe = service.subscribe(changed);
    const current = service.open(link);
    expect(current.cwd).toBe(cwd);
    expect(service.open(cwd)).toBe(current);
    expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe();
    service.open(repo('another'));
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('keeps the active scope when another checkout fails validation', () => {
    const service = createRepositoryService([]);
    const current = service.open(repo('valid'));
    expect(() => service.open(join(fixture.home, 'missing'))).toThrow(
      'Not a git repository'
    );
    expect(service.getSnapshot()).toBe(current);
    expect(service.isActive(current.cwd)).toBe(true);
  });

  it('reloads repository and viewer identity after configuration changes', () => {
    const service = createRepositoryService(providers);
    const cwd = repo('identity');
    const current = service.open(cwd);
    expect(current.providerId).toBeNull();
    writeProjectConfig(
      { vendor: 'github', vendorProject: { username: 'bob' } },
      cwd
    );
    const next = service.reload();
    expect(next?.viewer).toBe('bob');
    expect(next?.repository?.repository).toBe('acme/app');
    expect(service.reload()).toBe(next);
  });
});
