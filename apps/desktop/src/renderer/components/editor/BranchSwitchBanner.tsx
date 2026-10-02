import { Banner } from '../ui/banner.js';

/**
 * Shown at the top of a tab whose worktree is on a different branch
 * from the one the tab was opened for — someone ran `git switch` in
 * it. Informational only: the tab follows the worktree, but its pull
 * request context is the new branch's, which may not be what the
 * agent in it was started to work on.
 */
export function BranchSwitchBanner({
  current,
  original,
}: {
  current: string;
  original: string;
}) {
  return (
    <Banner aria-label="Branch switched">
      <strong>Branch switched</strong> from{' '}
      <code className="font-mono">{original}</code> to{' '}
      <code className="font-mono">{current}</code>
    </Banner>
  );
}
