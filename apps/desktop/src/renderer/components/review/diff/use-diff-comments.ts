import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { DiffLine } from '@n10/diff';
import type { LineRange } from '../../../../host/contract.js';
import { pullRequestRefFor } from '../../../lib/data/pr-snapshot-query.js';
import {
  across,
  extendOnScreen,
  headPoint,
  isSelected,
  neighbour,
  rangeSource,
  rangeWords,
  samePoint,
  select,
  selectionRange,
  shownIn,
  type LinePoint,
  type LineSelection,
} from '../../../lib/diff/range-selection.js';
import type { MyDraftsScope } from '../../../lib/review/my-drafts-context.js';
import {
  byFile,
  countByFile,
  inlineTargets,
  unstored,
  type InlineTarget,
} from '../../../lib/review/my-drafts.js';
import { useInlineDraftTargets } from '../../../lib/review/review-drafts.js';
import { useRepo } from '../../../lib/repo-context.js';
import type { GutterProps } from './LineGutter.js';

/** How the list moves focus to rows it may not have mounted. */
export interface LineNav {
  pointsOf: (file: string) => readonly LinePoint[];
  rowOf: (point: LinePoint) => number | undefined;
  /** With `onlyIfLost`, only when the keyboard has nowhere to be. */
  focus: (point: LinePoint, onlyIfLost?: boolean) => void;
  focusFileComment: (file: string) => void;
  focusDraft: (key: string) => void;
}

const VERTICAL = new Set(['ArrowDown', 'ArrowUp']);
const SIDEWAYS = new Set(['ArrowLeft', 'ArrowRight']);
const STOPPED = 'The range can’t grow further on this side';

/**
 * The reviewer's own comments in the diff: which lines are selected,
 * which composers are open, and the drafts to hang at their anchors.
 * A new comment is a draft from its first keystroke; nothing here
 * writes to the provider.
 */
export function useDiffComments({
  prId,
  head,
  linesByFile,
  split,
}: {
  prId: number;
  /** The commit the diff was read at: the one a new comment's line
   *  numbers belong to. */
  head: string | null;
  linesByFile: ReadonlyMap<string, DiffLine[]>;
  split: boolean;
}) {
  const { repo } = useRepo();
  const ref = pullRequestRefFor(repo, prId);
  const stored = useInlineDraftTargets(ref);
  // `note` says why the last move did not extend the range.
  const [picked, setPicked] = useState<{
    sel: LineSelection;
    note?: string;
  } | null>(null);
  // An old-side range over unchanged lines, picked in Split, has
  // nothing to show in Unified; every other range shows in both.
  const selection =
    picked && shownIn(picked.sel, split, linesByFile.get(picked.sel.file) ?? [])
      ? picked.sel
      : null;
  const [fresh, setFresh] = useState<readonly InlineTarget[]>([]);
  const [editing, setEditingKeys] = useState<ReadonlySet<string>>(new Set());
  const opening = useRef(new Set<string>());
  const nav = useRef<LineNav | null>(null);

  // Once a closed composer's draft is stored, the stored one stands
  // for it; an open composer keeps its own entry whatever is stored.
  const [seen, setSeen] = useState({ stored, editing });
  if (seen.stored !== stored || seen.editing !== editing) {
    setSeen({ stored, editing });
    setFresh((f) => unstored(f, stored, editing));
  }
  const mineByFile = useMemo(
    () => byFile(inlineTargets(stored, fresh)),
    [stored, fresh]
  );
  // What is kept, not composers opened and still empty.
  const mineCount = useMemo(() => countByFile(stored), [stored]);

  const setEditing = useCallback((key: string, on: boolean) => {
    if (on) opening.current.add(key);
    setEditingKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);
  const restore = useCallback(
    (target: InlineTarget) =>
      setFresh((f) =>
        f.some((t) => t.key === target.key) ? f : [...f, target]
      ),
    []
  );

  const setSelection = (
    next: (sel: LineSelection | null) => LineSelection | null
  ) => {
    const sel = next(selection);
    setPicked(sel ? { sel } : null);
  };

  const commentOn = (file: string, range: LineRange | null) => {
    const lines = linesByFile.get(file) ?? [];
    const target: InlineTarget = {
      kind: 'inline',
      key: crypto.randomUUID(),
      anchor: {
        path: file,
        previousPath: null,
        range,
        // The commit these line numbers belong to; publication files
        // the comment on that commit or not at all. The lines
        // themselves tell when the code under it changes.
        head,
        lines: range ? rangeSource(lines, range) : [],
      },
    };
    restore(target);
    setEditing(target.key, true);
    setPicked(null);
  };

  const commentOnSelection = (at: LinePoint) => {
    const sel = isSelected(selection, at) ? selection! : select(at);
    commentOn(sel.file, selectionRange(sel));
  };

  const pointsOf = (file: string) => nav.current?.pointsOf(file) ?? [];

  const step = (e: KeyboardEvent, point: LinePoint): LinePoint | null => {
    const points = pointsOf(point.file);
    if (SIDEWAYS.has(e.key)) {
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      return across(points, point, dir, (p) => nav.current?.rowOf(p));
    }
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    return neighbour(points, point, dir, e.shiftKey || split);
  };

  const move = (e: KeyboardEvent, point: LinePoint) => {
    const next = step(e, point);
    const extending = e.shiftKey && VERTICAL.has(e.key);
    // Shift+Arrow grows the selection the focused line is in, or starts
    // one there.
    const from = isSelected(selection, point) ? selection! : select(point);
    const sel =
      next &&
      (extending
        ? extendOnScreen(pointsOf(point.file), from, next)
        : select(next));
    if (!next || !sel) {
      if (!extending) return;
      // A range stops where the lines on screen stop being consecutive;
      // say so, or a screen reader hears nothing happen.
      setPicked({ sel: from, note: STOPPED });
      return;
    }
    setPicked({ sel });
    nav.current?.focus(next);
  };

  const onKey = (e: KeyboardEvent, point: LinePoint) => {
    // Alt and Mod chords belong to the diff's own navigation.
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    // Unified has no columns: Left/Right stay the list's to scroll.
    if (VERTICAL.has(e.key) || (split && SIDEWAYS.has(e.key))) {
      e.preventDefault();
      move(e, point);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commentOnSelection(point);
    } else if (e.key === 'Escape' && selection) {
      e.stopPropagation();
      setPicked(null);
    }
  };

  const onPoint = (p: LinePoint, extending: boolean) =>
    setSelection((sel) => {
      if (extending)
        return extendOnScreen(pointsOf(p.file), sel, p) ?? select(p);
      // Clicking the one selected line again lets it go.
      const only = sel && sel.anchor === sel.head;
      return only && isSelected(sel, p) ? null : select(p);
    });

  const range = selection ? selectionRange(selection) : null;
  const end: LinePoint | null =
    selection && range
      ? { file: selection.file, side: selection.side, line: range.end }
      : null;

  /** The gutter for `point`; `first` is its file's tab stop while
   *  nothing in the file is selected. */
  const gutterFor = (
    point: LinePoint,
    first: LinePoint | null
  ): GutterProps => ({
    point,
    selected: isSelected(selection, point),
    tabbable:
      selection?.file === point.file
        ? samePoint(headPoint(selection), point)
        : samePoint(first, point),
    commentHere: samePoint(end, point),
    rangeLabel: range ? rangeWords(range) : null,
    onPoint,
    onKey,
    onComment: () => commentOnSelection(point),
  });

  const scope: MyDraftsScope = {
    ref,
    editing,
    openComposer: (target) => {
      restore(target);
      setEditing(target.key, true);
    },
    closeComposer: (key) => setEditing(key, false),
    takeFocus: (key) => opening.current.delete(key),
    dropFresh: (key) => setFresh((f) => f.filter((t) => t.key !== key)),
    restore,
    linesOf: (path) => linesByFile.get(path),
    focusAnchor: ({ anchor }) => {
      const r = anchor.range;
      if (!r) return nav.current?.focusFileComment(anchor.path);
      const point = { file: anchor.path, side: r.side, line: r.end };
      nav.current?.focus(point, true);
    },
    focusDraft: (key) => nav.current?.focusDraft(key),
  };

  const announcement = announce(selection, picked?.note);

  return {
    mineByFile,
    mineCount,
    scope,
    gutterFor,
    commentOn,
    nav,
    announcement,
  };
}

/** What the list's live region says about the selection. */
function announce(sel: LineSelection | null, note: string | undefined) {
  if (!sel) return '';
  const said = `${rangeWords(selectionRange(sel))} selected in ${sel.file}`;
  return note ? `${said}. ${note}` : said;
}
