import { Loader2Icon, RefreshCwIcon } from 'lucide-react';
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { refocusAfter } from '../../../lib/focus.js';
import type { MovedRevision } from '../../../lib/review/pinned-revisions.js';
import type { LoadMoved } from '../../../lib/review/use-pr-diff.js';
import { Banner } from '../../ui/banner.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';

const short = (oid: string) => oid.slice(0, 7);

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono">{children}</code>;
}

/** What moved — the head, the target or both — and what is on screen. */
function MovedSentence({
  moved,
  shownHead,
}: {
  moved: MovedRevision;
  shownHead: string;
}) {
  const reading = <Code>{short(shownHead)}</Code>;
  const against = <Code>{moved.readingTarget}</Code>;
  if (moved.head && moved.target) {
    return (
      <>
        The pull request moved to <Code>{short(moved.head)}</Code> and now
        targets <Code>{moved.target}</Code>. You are reading {reading} against{' '}
        {against}.
      </>
    );
  }
  if (moved.head) {
    return (
      <>
        The pull request moved to <Code>{short(moved.head)}</Code>. You are
        reading {reading}.
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
  shownHead,
  load,
  focusAfter,
}: {
  moved: MovedRevision;
  shownHead: string;
  load: LoadMoved;
  /** Where the keyboard goes when the banner closes itself after a
   *  load: the comparison it loaded. */
  focusAfter: RefObject<HTMLElement | null>;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // The button goes with the banner once the load succeeds; the browser
  // would drop its focus on the page.
  useLayoutEffect(
    () => () => {
      if (document.activeElement === button.current) {
        refocusAfter(() => focusAfter.current);
      }
    },
    [focusAfter]
  );
  const action = moved.head
    ? 'Load new commits'
    : `Compare with ${moved.target}`;
  const tip = moved.head ? `Load the diff at ${short(moved.head)}` : action;
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
      <MovedSentence moved={moved} shownHead={shownHead} />
      {load.error && (
        <span className="font-medium">
          {' '}
          Couldn&apos;t load it: {load.error}
        </span>
      )}
    </Banner>
  );
}
