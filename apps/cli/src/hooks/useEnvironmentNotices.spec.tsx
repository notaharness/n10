import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ToastProvider } from '@n10/app-core';
import type { EnvironmentNotice } from '@n10/core';
import { ToastStack } from '../components/ToastContainer.js';
import { useEnvironmentNotices } from './useEnvironmentNotices.js';

const NOTICES: EnvironmentNotice[] = [
  { id: 'windows-drive', message: 'On a Windows drive' },
];

function Probe({ notices }: { notices: readonly EnvironmentNotice[] }) {
  useEnvironmentNotices(notices);
  return <ToastStack />;
}

describe('useEnvironmentNotices', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows each notice as a warning long enough to read', async () => {
    vi.useFakeTimers();
    const { lastFrame } = render(
      <ToastProvider>
        <Probe notices={NOTICES} />
      </ToastProvider>
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(lastFrame()).toContain('On a Windows drive');
    await vi.advanceTimersByTimeAsync(8_000);
    // Ink paints the dismissal on its next throttled frame.
    await vi.advanceTimersByTimeAsync(100);
    expect(lastFrame()).not.toContain('On a Windows drive');
  });

  it('shows nothing when there are no notices', () => {
    const { lastFrame } = render(
      <ToastProvider>
        <Probe notices={[]} />
      </ToastProvider>
    );
    expect(lastFrame()).toBe('');
  });
});
