import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type * as Os from 'node:os';
import {
  readConfig,
  readGlobalConfig,
  readProjectConfig,
  writeGlobalConfig,
  writeProjectConfig,
} from '@n10/vcs-core';
import type { VcsProvider } from '@n10/vcs-core';
import type { SettingsField } from '@n10/core';
import { createConfigService } from './config-service.js';

const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (original) => {
  const os = await original<typeof Os>();
  const fs = await import('node:fs');
  const path = await import('node:path');
  fixture.home = fs.mkdtempSync(path.join(os.tmpdir(), 'n10-config-'));
  return { ...os, homedir: () => fixture.home };
});

const providers = ['github', 'azure-devops'].map((id) => ({
  id,
  isConfigured: (
    auth: Record<string, string>,
    project: Record<string, string>
  ) => Boolean(auth.token && project.repo),
})) as VcsProvider[];

function field(
  key: string,
  configBag: SettingsField['configBag'] = 'global'
): SettingsField {
  return { key, configBag, label: key };
}

function harness(repo = '/repo-a') {
  const events: string[] = [];
  const pullRequests = {
    credentialsChanged: vi.fn(() => {
      events.push('credentials');
    }),
    read: vi.fn((cwd: string) => {
      events.push(`read:${cwd}:${readConfig(cwd).vendorAuth.token}`);
      return Promise.resolve({});
    }),
  };
  const restartSync = vi.fn((cwd: string) => {
    events.push(`sync:${cwd}`);
  });
  const service = createConfigService({
    repo,
    providers,
    pullRequests,
    restartSync,
  });
  service.subscribe(() => {
    events.push('snapshot');
  });
  return { service, events, pullRequests, restartSync };
}

beforeEach(() => {
  rmSync(join(fixture.home, '.n10'), { recursive: true, force: true });
  writeGlobalConfig({
    editor: 'code',
    vendorAuth: {
      github: { token: 'old' },
      'azure-devops': { token: 'azure' },
    },
  });
  writeProjectConfig(
    { vendor: 'github', vendorProject: { repo: 'a' } },
    '/repo-a'
  );
  writeProjectConfig(
    { vendor: 'github', vendorProject: { repo: 'b' } },
    '/repo-b'
  );
});
afterAll(() => rmSync(fixture.home, { recursive: true, force: true }));

describe('config commands', () => {
  it('persists before invalidation, refresh, sync and snapshot notification', () => {
    const { service, events, pullRequests } = harness();
    service.updateField(field('token', 'vendorAuth'), 'new');
    expect(events).toEqual([
      'credentials',
      'read:/repo-a:new',
      'sync:/repo-a',
      'snapshot',
    ]);
    expect(pullRequests.read).toHaveBeenCalledExactlyOnceWith('/repo-a', {
      force: true,
    });
    expect(service.getSnapshot()).toMatchObject({
      revision: 1,
      syncRevision: 1,
    });
  });

  it('writes the captured repository regardless of process cwd', () => {
    const { service } = harness();
    service.updateField(field('repo', 'vendorProject'), 'changed-a');
    service.updateField(field('email', 'project'), 'a@example.test');
    expect(readConfig('/repo-a')).toMatchObject({
      vendorProject: { repo: 'changed-a' },
      email: 'a@example.test',
    });
    expect(readConfig('/repo-b')).toMatchObject({
      vendorProject: { repo: 'b' },
      email: undefined,
    });
    expect(service.getSnapshot().config.vendorProject.repo).toBe('changed-a');
  });

  it('reads the selected provider credentials and preserves other vendors', () => {
    const { service } = harness();
    service.updateField(field('vendor', 'project'), 'azure-devops');
    expect(service.getSnapshot()).toMatchObject({
      provider: { id: 'azure-devops' },
      config: { vendorAuth: { token: 'azure' } },
      vcsConfigured: true,
    });
    service.updateField(field('token', 'vendorAuth'), 'rotated');
    expect(readGlobalConfig().vendorAuth).toEqual({
      github: { token: 'old' },
      'azure-devops': { token: 'rotated' },
    });
  });

  it('restores the global value immediately when a project override is cleared', () => {
    writeProjectConfig({ editor: 'vim' }, '/repo-a');
    const { service } = harness();
    service.updateField(field('editor', 'project'), undefined);
    expect(service.getSnapshot().config.editor).toBe('code');
    expect(readProjectConfig('/repo-a').editor).toBeUndefined();
  });

  it('round-trips booleans and finite intervals through the persisted config', () => {
    const { service, restartSync, pullRequests } = harness();
    service.updateField(field('diffFileListTree'), 'false');
    service.updateField(field('autoRebase'), 'true');
    service.updateField(field('mergePollInterval'), '300000');
    expect(service.getSnapshot().config).toMatchObject({
      diffFileListTree: false,
      autoRebase: true,
      mergePollInterval: 300000,
    });
    expect(restartSync).toHaveBeenCalledExactlyOnceWith('/repo-a');
    expect(pullRequests.read).not.toHaveBeenCalled();
    service.updateField(field('mergePollInterval'), 'Infinity');
    expect(service.getSnapshot().config.mergePollInterval).toBeUndefined();
  });

  it('refreshes the PR cadence without resetting provider memos or sync', () => {
    const { service, events } = harness();
    service.updateField(field('prPollInterval'), '15000');
    expect(events).toEqual(['read:/repo-a:old', 'snapshot']);
    expect(service.getSnapshot().syncRevision).toBe(0);
  });

  it('keeps snapshot identity and effects stable on no-op writes and reloads', () => {
    const { service, events } = harness();
    const before = service.getSnapshot();
    service.updateField(field('token', 'vendorAuth'), 'old');
    service.reload();
    expect(service.getSnapshot()).toBe(before);
    expect(events).toEqual([]);
  });

  it('stores an explicit override even when the effective value is unchanged', () => {
    const { service, events } = harness();
    service.updateField(field('editor', 'project'), 'code');
    expect(readProjectConfig('/repo-a').editor).toBe('code');
    expect(events).toEqual([]);
  });

  it('does not publish state or effects when persistence fails', () => {
    const { service, events } = harness();
    const before = service.getSnapshot();
    const path = join(fixture.home, '.n10', 'config.json');
    rmSync(path);
    mkdirSync(path);
    expect(() => service.updateField(field('prPollInterval'), '100')).toThrow();
    expect(service.getSnapshot()).toBe(before);
    expect(events).toEqual([]);
  });

  it('reloads auto-detected project changes through the same effects', () => {
    const { service, events } = harness();
    writeProjectConfig(
      { vendor: 'github', vendorProject: { repo: 'detected' } },
      '/repo-a'
    );
    service.reload();
    expect(events).toEqual([
      'credentials',
      'read:/repo-a:old',
      'sync:/repo-a',
      'snapshot',
    ]);
    expect(service.getSnapshot().config.vendorProject.repo).toBe('detected');
  });

  it('applies sequential keybind patches to current disk values', () => {
    const { service, events } = harness();
    service.updateKeybindFields((prev) => ({ ...prev, keybindPreset: 'vim' }));
    service.updateKeybindFields((prev) => ({
      ...prev,
      keybindOverrides: { quit: [{ input: 'x' }] },
    }));
    expect(service.getSnapshot().config).toMatchObject({
      keybindPreset: 'vim',
      keybindOverrides: { quit: [{ input: 'x' }] },
      editor: 'code',
    });
    expect(events).toEqual(['snapshot', 'snapshot']);
  });

  it('unsubscribes without affecting the service lifetime', () => {
    const { service } = harness();
    const listener = vi.fn();
    const stop = service.subscribe(listener);
    service.updateField(field('editor'), 'vim');
    stop();
    service.updateField(field('editor'), 'zed');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().config.editor).toBe('zed');
  });
});
