import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { DiffLine } from '@n10/diff';
import { diffTextMatches } from '../../../lib/diff/text-matches.js';
import type { TextMatch } from '../../../lib/diff/text-matches.js';
import type { DiffPlaceControls } from '../../../lib/diff/use-single-file.js';
import type { PrDiffView } from '../../../lib/review/use-pr-diff.js';
import {
  coverageMessage,
  diffFindCoverage,
  type FindCoverage,
} from './diff-find-coverage.js';

function isVisibleDiffTarget(
  pane: HTMLDivElement | null,
  target: HTMLElement | null
): boolean {
  return Boolean(
    pane &&
      target &&
      pane.getClientRects().length &&
      !pane.closest('[inert]') &&
      (pane.contains(target) || target === document.body)
  );
}

/** With Ctrl or Cmd, Shift or not, this key opens find in the diff. */
export const FIND_KEY = 'f';

function isFindShortcut(
  event: KeyboardEvent,
  target: HTMLElement,
  input: HTMLInputElement | null
): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== FIND_KEY)
    return false;
  return (
    target === input ||
    !target.closest('input, textarea, [contenteditable="true"]')
  );
}

function coverageActions(
  coverage: FindCoverage,
  prDiff: PrDiffView | undefined
) {
  if (!prDiff) return {};
  return {
    onReadFull: coverage.fullRead.length
      ? () =>
          coverage.fullRead.forEach((path) =>
            prDiff.readAlone(path, 'whole-file')
          )
      : undefined,
    onRetry: coverage.failed.length
      ? () => coverage.failed.forEach((path) => prDiff.retryFile(path))
      : undefined,
    onReadChanges: coverage.changesRead.length
      ? () =>
          coverage.changesRead.forEach((path) =>
            prDiff.readAlone(path, 'changes')
          )
      : undefined,
  };
}

export function useDiffFind(
  files: [string, DiffLine[]][],
  scrollRef: RefObject<HTMLDivElement | null>,
  paneRef: RefObject<HTMLDivElement | null>,
  place: DiffPlaceControls,
  single: boolean,
  prDiff: PrDiffView | undefined
) {
  const findRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{
    ordinal: number;
    match: TextMatch | null;
  }>({ ordinal: 0, match: null });
  const [request, setRequest] = useState(0);
  const pendingFirst = useRef<{
    query: string;
    file: string | null;
    conversation: boolean;
  } | null>(null);
  const matches = useMemo(() => diffTextMatches(files, query), [files, query]);
  const retained =
    selected.match &&
    matches.findIndex(
      (match) =>
        match.file === selected.match?.file &&
        match.index === selected.match.index &&
        match.start === selected.match.start &&
        match.end === selected.match.end
    );
  const index =
    retained != null && retained >= 0
      ? retained
      : Math.min(selected.ordinal, matches.length - 1);
  const target = open ? matches[index] ?? null : null;
  const coverage = useMemo(() => diffFindCoverage(prDiff), [prDiff]);
  const actions = coverageActions(coverage, prDiff);
  useEffect(() => {
    const pending = pendingFirst.current;
    if (!pending || !open || !single || pending.query !== query) return;
    if (
      place.file !== pending.file ||
      place.conversation !== pending.conversation
    ) {
      pendingFirst.current = null;
      return;
    }
    const first = matches[0];
    if (first) {
      pendingFirst.current = null;
      place.select(first.file);
    }
  }, [matches, query, open, single, place]);
  const close = () => {
    pendingFirst.current = null;
    setOpen(false);
    setQuery('');
    scrollRef.current?.focus();
  };
  const step = (delta: number) => {
    if (!matches.length) return;
    pendingFirst.current = null;
    const next = (index + delta + matches.length) % matches.length;
    setSelected({ ordinal: next, match: matches[next] });
    setRequest((current) => current + 1);
    if (single) place.select(matches[next].file);
  };
  const changeQuery = (value: string) => {
    const first = diffTextMatches(files, value)[0] ?? null;
    pendingFirst.current =
      single && value && !first
        ? { query: value, file: place.file, conversation: place.conversation }
        : null;
    setQuery(value);
    setSelected({ ordinal: 0, match: first });
    setRequest((current) => current + 1);
    if (single && first) place.select(first.file);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const pane = paneRef.current;
      const target = event.target as HTMLElement | null;
      if (!isVisibleDiffTarget(pane, target) || !target) return;
      if (isFindShortcut(event, target, findRef.current)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(true);
        requestAnimationFrame(() => findRef.current?.focus());
      } else if (event.key === 'Escape' && open && target === findRef.current) {
        event.preventDefault();
        pendingFirst.current = null;
        setOpen(false);
        setQuery('');
        scrollRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, paneRef, scrollRef]);

  return {
    term: open ? query : '',
    target,
    request,
    bar: open ? (
      <FindBar
        findRef={findRef}
        query={query}
        count={matches.length}
        index={index}
        coverage={coverageMessage(coverage)}
        onReadFull={actions.onReadFull}
        onRetry={actions.onRetry}
        onReadChanges={actions.onReadChanges}
        onQuery={changeQuery}
        onStep={step}
        onClose={close}
      />
    ) : null,
  };
}

function FindBar({
  findRef,
  query,
  count,
  index,
  coverage,
  onReadFull,
  onRetry,
  onReadChanges,
  onQuery,
  onStep,
  onClose,
}: {
  findRef: RefObject<HTMLInputElement | null>;
  query: string;
  count: number;
  index: number;
  coverage: string | null;
  onReadFull?: () => void;
  onRetry?: () => void;
  onReadChanges?: () => void;
  onQuery: (query: string) => void;
  onStep: (delta: number) => void;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center justify-end gap-2 border-b border-border px-3 py-1 text-xs">
      <input
        ref={findRef}
        type="search"
        aria-label="Find in diff"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          }
        }}
        className="h-7 w-52 rounded border border-input bg-background px-2 outline-none focus:ring-2 focus:ring-ring/60"
      />
      <span
        data-testid="diff-find-count"
        className="min-w-12 tabular-nums text-muted-foreground"
      >
        {count ? index + 1 : 0} of {count}
        {coverage ? '+' : ''}
      </span>
      <button
        type="button"
        aria-label="Previous match"
        onClick={() => onStep(-1)}
      >
        ↑
      </button>
      <button type="button" aria-label="Next match" onClick={() => onStep(1)}>
        ↓
      </button>
      <button type="button" aria-label="Close find" onClick={onClose}>
        ×
      </button>
      {query && coverage && (
        <span role="status" className="text-muted-foreground">
          {coverage}
        </span>
      )}
      {query && onReadFull && (
        <button type="button" onClick={onReadFull}>
          Load full files
        </button>
      )}
      {query && onRetry && (
        <button type="button" onClick={onRetry}>
          Retry files
        </button>
      )}
      {query && onReadChanges && (
        <button type="button" onClick={onReadChanges}>
          Load changes
        </button>
      )}
    </div>
  );
}
