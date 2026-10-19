// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoInfo } from '../../host/contract.js';
import { useEnvironmentNotices } from './use-environment-notices.js';

const { warning } = vi.hoisted(() => ({ warning: vi.fn() }));
vi.mock('sonner', () => ({ toast: { warning } }));

declare global {
  // The flag React's act() reads.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const repoAt = (cwd: string, messages: string[]): RepoInfo => ({
  cwd,
  providerId: null,
  vcsConfigured: false,
  repository: null,
  viewer: null,
  reviewEvents: [],
  notices: messages.map((message) => ({ id: 'windows-drive', message })),
});

function Probe({ repo }: { repo: RepoInfo | null }) {
  useEnvironmentNotices(repo);
  return null;
}

let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  warning.mockReset();
  root = createRoot(document.createElement('div'));
});

afterEach(() => {
  act(() => root.unmount());
});

describe('useEnvironmentNotices', () => {
  it("toasts a repository's notices once, however often it is shown", () => {
    const drive = repoAt('/mnt/c/one', ['On a Windows drive']);
    act(() => root.render(<Probe repo={drive} />));
    act(() => root.render(<Probe repo={repoAt('/home/ada/two', [])} />));
    act(() => root.render(<Probe repo={{ ...drive }} />));
    expect(warning).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith('On a Windows drive', {
      duration: 12_000,
    });
  });

  it('shows nothing before a repository is open', () => {
    act(() => root.render(<Probe repo={null} />));
    expect(warning).not.toHaveBeenCalled();
  });
});
