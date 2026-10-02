import { Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { refocusAfter } from '../../../lib/focus.js';
import type { MovedRevision } from '../../../lib/review/pinned-revisions.js';
import type { LoadMoved } from '../../../lib/review/use-pr-diff.js';
import { Banner } from '../../ui/banner.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono">{children}</code>;
}

/** What moved — the head, the target or both — said in words: the
 *  diff stays as the reader read it until they load what moved. */
function MovedSentence({ moved }: { moved: MovedRevision }) {
  const against = <Code>{moved.readingTarget}</Code>;
  if (moved.head && moved.target) {
    return (
      <>
        New commits were pushed since you opened this, and the pull request now
        targets <Code>{moved.target}</Code>. You are still reading it against{' '}
        {against}, without them.
      </>
    );
  }
  if (moved.head) {
    return (
      <>
        New commits were pushed since you opened this. You are still reading the
        changes without them.
      </>
    );
  }
  return (
    <>
      The pull request now targets <Code>{moved.target}</Code>. You are reading
      it against {against}.
    </>
  );
}

/**
 * The provider reports a revision the diff on screen is not at. The
 * diff stays where the reader is until they load the new one, and a
 * load that fails leaves it there and says why.
 */
export function MovedBanner({
  moved,
  load,
  focusAfter,
}: {
  moved: MovedRevision;
  load: LoadMoved;
  /** Where the keyboard goes when the banner closes itself after a
   *  load: the comparison it loaded. */
  focusAfter: () => HTMLElement | null | undefined;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // The button goes with the banner once the load succeeds; the browser
  // would drop its focus on the page.
  useLayoutEffect(
    () => () => {
      if (document.activeElement === button.current) {
        refocusAfter(focusAfter);
      }
    },
    [focusAfter]
  );
  const action = moved.head
    ? 'Load new commits'
    : `Compare with ${moved.target}`;
  const tip = moved.head ? 'Show the diff with the new commits' : action;
  return (
    <Banner
      aria-label={moved.head ? 'New commits' : 'New target'}
      aria-busy={load.loading}
      actions={
        <Tip label={tip}>
          {/* aria-disabled rather than disabled, so focus stays on the
              button while it loads; a press meanwhile does nothing. */}
          <Button
            ref={button}
            variant="outline"
            size="sm"
            onClick={load.run}
            aria-disabled={load.loading}
            className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            {load.loading ? (
              <Loader2Icon className="animate-spin" />
            ) : (
              <RefreshCwIcon />
            )}
            {action}
          </Button>
        </Tip>
      }
    >
      <MovedSentence moved={moved} />
      {load.error && (
        <span className="font-medium">
          {' '}
          Couldn&apos;t load it: {load.error}
        </span>
      )}
    </Banner>
  );
}
