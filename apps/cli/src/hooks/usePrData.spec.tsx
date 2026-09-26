// usePrData reads its provider through useConfig and reports through
// useToastActions; both are stubbed at their module boundary, as in
// useSidebar.spec.tsx, because usePrData imports them relatively.

import { describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import type { BranchPrMap } from '@n10/vcs-core';
import { usePrData } from '@n10/app-core';

const events = vi.hoisted(() => [] as string[]);
const pending = vi.hoisted(() => [] as (() => void)[]);

// Stable identities: usePrData's fetch callback depends on these, and a
// fresh object each render would make every render a new fetch.
const configValue = vi.hoisted(() => ({
  config: { vendorAuth: {}, vendorProject: {}, prPollInterval: 60_000 },
  provider: {
    isConfigured: () => true,
    forgetPullRequestCache: () => {
      events.push('forget');
    },
    fetchPullRequests: () => {
      events.push('start');
      return new Promise<BranchPrMap>((resolve) =>
        pending.push(() => {
          events.push('end');
          resolve({});
        })
      );
    },
  },
}));

vi.mock(
  '../../../../libs/app-core/src/lib/context/ConfigContext.js',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useConfig: () => configValue,
  })
);

vi.mock(
  '../../../../libs/app-core/src/lib/context/ToastContext.js',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useToastActions: () => ({ flash: () => undefined }),
  })
);

async function flush() {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('usePrData', () => {
  it('forgets the provider cache when the refresh fetch starts, after a poll already out has written to it', async () => {
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
    const { unmount } = render(<Probe />);
    await flush();
    expect(events).toEqual(['start']);

    const refreshed = outRef.current!.refresh();
    pending.shift()!();
    await flush();
    pending.shift()!();
    await refreshed;

    expect(events).toEqual(['start', 'end', 'forget', 'start', 'end']);
    unmount();
  });
});
