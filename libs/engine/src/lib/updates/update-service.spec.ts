import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateCheckError } from '@n10/core';
import type { UpdateCache, RegistryVersion } from '@n10/core';
import type { UpdatePreferences, UpdateStore } from './update-types.js';
import { createUpdateService } from './update-service.js';

function setup(initial: UpdateCache = {}) {
  let cache = initial;
  let preferences: UpdatePreferences = { channel: 'preview', automatic: true };
  const store: UpdateStore = {
    readCache: () => cache,
    writeCache: (value) => {
      cache = value;
    },
    readPreferences: () => preferences,
    writePreferences: (value) => {
      preferences = value;
    },
  };
  const read = vi
    .fn<() => Promise<RegistryVersion>>()
    .mockResolvedValue({ version: '1.0.0-beta.10' });
  const service = createUpdateService({
    installation: { kind: 'npm-global', version: '1.0.0-beta.1' },
    store,
    read,
    random: () => 0,
  });
  return { service, store, read };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('app update scheduling', () => {
  it.each(['development', 'packaged'] as const)(
    'ignores npm cache and checks for %s installations',
    async (kind) => {
      const { store, read } = setup({
        version: '2.0.0',
        checkedAt: Date.now(),
      });
      const service = createUpdateService({
        installation: { kind, version: '1.0.0' },
        store,
        read,
      });
      service.start();
      await service.check();
      await vi.advanceTimersByTimeAsync(2000);
      expect(read).not.toHaveBeenCalled();
      expect(service.getSnapshot()).toMatchObject({
        availableVersion: null,
        checkedAt: null,
        command: null,
      });
      service.stop();
    }
  );
  it('checks after startup, skips fresh cache, and checks again daily', async () => {
    const { service, read } = setup();
    service.start();
    await vi.advanceTimersByTimeAsync(1999);
    expect(read).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(read).toHaveBeenCalledTimes(2);
    service.stop();
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('coalesces manual requests, retains last good data on failure and retries explicitly', async () => {
    const { service, read } = setup();
    let finish!: (result: RegistryVersion) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = service.check();
    const second = service.check();
    expect(read).toHaveBeenCalledTimes(1);
    finish({ version: '1.0.0-beta.10' });
    await Promise.all([first, second]);
    read.mockRejectedValueOnce(new Error('offline'));
    await service.check();
    expect(service.getSnapshot()).toMatchObject({
      availableVersion: '1.0.0-beta.10',
      error: expect.any(String),
      checking: false,
    });
    await service.check();
    expect(service.getSnapshot().error).toBeNull();
  });
  it('keeps rate limits across process recreation and even explicit checks wait', async () => {
    const { service, read, store } = setup();
    read.mockRejectedValueOnce(
      new UpdateCheckError('rate limited', Date.now() + 3_600_000)
    );
    await service.check();
    const next = createUpdateService({
      installation: { kind: 'npm-global', version: '1.0.0-beta.1' },
      store,
      read,
    });
    await next.check();
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_600_000);
    await next.check();
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('saves decorative Stable and automatic-off across shells while manual checking still works', async () => {
    const { service, read, store } = setup();
    service.setPreferences({ channel: 'stable', automatic: false });
    service.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(read).not.toHaveBeenCalled();
    await service.check();
    expect(service.getSnapshot().availableVersion).toBe('1.0.0-beta.10');
    expect(store.readPreferences()).toEqual({
      channel: 'stable',
      automatic: false,
    });
    store.writePreferences({ channel: 'preview', automatic: true });
    service.reloadPreferences();
    expect(service.getSnapshot().preferences.channel).toBe('preview');
    service.stop();
  });
  it('uses last successful persisted metadata without another startup request', async () => {
    const { service, read } = setup({
      version: '1.0.0-beta.10',
      checkedAt: Date.now(),
      nextCheckAt: Date.now() + 86_400_000,
    });
    expect(service.getSnapshot().availableVersion).toBe('1.0.0-beta.10');
    service.start();
    await vi.advanceTimersByTimeAsync(2000);
    expect(read).not.toHaveBeenCalled();
    service.stop();
  });
});
