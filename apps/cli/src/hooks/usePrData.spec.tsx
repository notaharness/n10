// usePrData reads its repository's list from the engine and reports
// through useConfig/useToastActions; the last two are stubbed at their
// module boundary, as in useSidebar.spec.tsx, because usePrData imports
// them relatively. The engine is the real one: what is asserted here is
// the hook's use of it — the list's semantics are the engine's spec.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type { AppConfig, BranchPrMap, VcsProvider } from '@n10/vcs-core';
import {
  createPullRequestList,
  createRemoteSync,
  createWorktreeCommands,
  type PullRequestList,
} from '@n10/engine';
import { EngineProvider, usePrData } from '@n10/app-core';

const flashes = vi.hoisted(() => [] as string[]);
// Stable identity between renders: the hook re-takes its watch when the
// config changes, which a test does by replacing `current`.
const configValue = vi.hoisted(() => ({ current: { config: {} } }));

vi.mock(
  '../../../../libs/app-core/src/lib/context/ConfigContext.js',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useConfig: () => configValue.current,
  })
);

vi.mock(
  '../../../../libs/app-core/src/lib/context/ToastContext.js',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useToastActions: () => ({
      flash: (message: string) => flashes.push(message),
    }),
  })
);

let pending: {
  resolve: (v: BranchPrMap) => void;
  reject: (e: Error) => void;
}[];
let project: Record<string, string>;
let list: PullRequestList;

const provider = {
  id: 'github',
  isConfigured: () => true,
  fetchPullRequests: () =>
    new Promise<BranchPrMap>((resolve, reject) =>
      pending.push({ resolve, reject })
    ),
} as unknown as VcsProvider;

async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

function mount() {
  const outRef: { current: ReturnType<typeof usePrData> | null } = {
    current: null,
  };
  function Probe() {
    const value = usePrData();
    useEffect(() => {
      outRef.current = value;
    });
    return <Box />;
  }
  const worktrees = createWorktreeCommands({ repo: '/repo' });
  const sync = createRemoteSync({
    config: {
      repo: '/repo',
      getSnapshot: () => ({
        config: { vendorAuth: {}, vendorProject: {} },
        provider: null,
        vcsConfigured: false,
        syncRevision: 0,
      }),
      subscribe: () => () => undefined,
    },
    pullRequests: list,
    worktrees,
  });
  const tree = () => (
    <EngineProvider
      pullRequests={list}
      repo="/repo"
      sync={sync}
      worktrees={worktrees}
    >
      <Probe />
    </EngineProvider>
  );
  const { unmount, rerender } = render(tree());
  return { outRef, unmount, rerender: () => rerender(tree()) };
}

beforeEach(() => {
  pending = [];
  project = { owner: 'acme', repo: 'widgets' };
  configValue.current = { config: {} };
  flashes.length = 0;
  list = createPullRequestList({
    providers: [provider],
    readConfig: () =>
      ({
        vendor: 'github',
        vendorAuth: {},
        vendorProject: { ...project },
      } as AppConfig),
  });
});

afterEach(() => {
  list.dispose();
});

describe('usePrData', () => {
  it('reads on mount and renders the list when it lands', async () => {
    const probe = mount();
    await flush();
    expect(list.fetchCount()).toBe(1);
    expect(probe.outRef.current?.loading).toBe(true);

    pending[0]!.resolve({ feature: null });
    await flush();
    expect(probe.outRef.current?.prMap).toEqual({ feature: null });
    expect(probe.outRef.current?.loading).toBe(false);
    probe.unmount();
  });

  it('refreshes through the engine, queued behind the read already out', async () => {
    const probe = mount();
    await flush();
    const refreshed = probe.outRef.current!.refresh();
    expect(list.fetchCount()).toBe(1);

    pending[0]!.resolve({ stale: null });
    await flush();
    expect(list.fetchCount()).toBe(2);
    pending[1]!.resolve({ fresh: null });
    await refreshed;
    await flush();
    expect(probe.outRef.current?.prMap).toEqual({ fresh: null });
    probe.unmount();
  });

  it('toasts a new error once, keeping the list', async () => {
    const probe = mount();
    await flush();
    pending[0]!.resolve({ feature: null });
    await flush();

    void probe.outRef.current!.refresh();
    pending[1]!.reject(new Error('rate limited'));
    await flush();
    expect(probe.outRef.current).toMatchObject({
      prMap: { feature: null },
      error: 'rate limited',
    });
    expect(flashes).toEqual(['PR error: rate limited']);
    probe.unmount();
  });

  it('reads the new scope as soon as the config changes', async () => {
    // Auto-detect or a settings edit points the repo at another project.
    // Without re-taking the watch, its list would wait out an interval.
    const probe = mount();
    await flush();
    pending[0]!.resolve({ widgets: null });
    await flush();

    project = { owner: 'acme', repo: 'gadgets' };
    configValue.current = { config: {} };
    probe.rerender();
    await flush();
    expect(list.fetchCount()).toBe(2);
    expect(probe.outRef.current?.prMap).toEqual({});
    pending[1]!.resolve({ gadgets: null });
    await flush();
    expect(probe.outRef.current?.prMap).toEqual({ gadgets: null });
    probe.unmount();
  });

  it('keeps the list fresh while mounted and lets go on unmount', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const probe = mount();
      await flush();
      pending[0]!.resolve({});
      await flush();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(list.fetchCount()).toBe(2);
      pending[1]!.resolve({});
      await flush();

      probe.unmount();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(list.fetchCount()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
