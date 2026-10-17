import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { SingleFileView } from '../../../lib/diff/use-single-file.js';
import { Button } from '../../ui/button.js';
import { Tip } from '../../ui/tooltip.js';

/**
 * Single-file mode's pager: where this section sits in the pull
 * request, and the way to the one before and after it. The file's own
 * name is in its header below, and in what the pager announces. At
 * either end a button is aria-disabled rather than disabled, so paging
 * to the last file with the keyboard does not drop focus to the page.
 */
export function SingleFileBar({
  page,
}: {
  page: NonNullable<SingleFileView['page']>;
}) {
  const { section } = page;
  const count = `${page.countIncomplete ? 'at least ' : ''}${page.fileCount}`;
  const label =
    section.kind === 'conversation'
      ? 'Conversation'
      : `File ${page.fileNumber} of ${count}`;
  return (
    <nav
      aria-label="Files"
      className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2 text-xs text-muted-foreground"
    >
      <Tip label="Previous file">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => page.step(-1)}
          aria-disabled={!page.hasPrevious}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          aria-label="Previous file"
        >
          <ChevronLeftIcon />
        </Button>
      </Tip>
      <span aria-live="polite" className="tabular-nums">
        {label}
        {section.kind === 'file' && (
          <span className="sr-only">: {section.path}</span>
        )}
      </span>
      <Tip label="Next file">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => page.step(1)}
          aria-disabled={!page.hasNext}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          aria-label="Next file"
        >
          <ChevronRightIcon />
        </Button>
      </Tip>
    </nav>
  );
}
