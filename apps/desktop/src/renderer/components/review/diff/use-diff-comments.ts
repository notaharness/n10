import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { DiffLine } from '@n10/diff';
import { isOid } from '@n10/vcs-core/pr-details';
import type { LineRange } from '../../../../host/contract.js';
import { pullRequestRefFor } from '../../../lib/data/pr-snapshot-query.js';
import {
  extend,
  headPoint,
  isSelected,
  neighbour,
  rangeSource,
  rangeWords,
  samePoint,
  select,
  selectionRange,
  type LinePoint,
  type LineSelection,
} from '../../../lib/diff/range-selection.js';
import type { MyDraftsScope } from '../../../lib/review/my-drafts-context.js';
import {
  byFile,
  inlineTargets,
  type InlineTarget,
} from '../../../lib/review/my-drafts.js';
import { useReviewDrafts } from '../../../lib/review/review-drafts.js';
import { useRepo } from '../../../lib/repo-context.js';
import type { GutterProps } from './LineGutter.js';

/** How the list moves focus between lines it may not have mounted. */
export interface LineNav {
  pointsOf: (file: string) => readonly LinePoint[];
  focus: (point: LinePoint) => void;
}

/**
 * The reviewer's own comments in the diff: which lines are selected,
 * which composers are open, and the drafts to hang at their anchors.
 * A new comment is a draft from its first keystroke; nothing here
 * writes to the provider.
 */
export function useDiffComments({
  prId,
  headSha,
  linesByFile,
  split,
}: {
  prId: number;
  headSha: string | undefined;
  linesByFile: ReadonlyMap<string, DiffLine[]>;
  split: boolean;
}) {
  const { repo } = useRepo();
  const ref = pullRequestRefFor(repo, prId);
  const drafts = useReviewDrafts(ref);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [fresh, setFresh] = useState<InlineTarget[]>([]);
  const [editing, setEditingKeys] = useState<ReadonlySet<string>>(new Set());
  const nav = useRef<LineNav | null>(null);

  const stored = drafts.data?.drafts;
  const mineByFile = useMemo(
    () => byFile(inlineTargets(stored ?? [], fresh)),
    [stored, fresh]
  );

  const setEditing = useCallback((key: string, on: boolean) => {
    setEditingKeys((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const commentOn = (file: string, range: LineRange | null) => {
    const lines = linesByFile.get(file) ?? [];
    const target: InlineTarget = {
      kind: 'inline',
      key: crypto.randomUUID(),
      anchor: {
        path: file,
        previousPath: null,
        range,
        head: isOid(headSha) ? headSha : null,
        lines: range ? rangeSource(lines, range) : [],
      },
    };
    setFresh((f) => [...f, target]);
    setEditing(target.key, true);
    setSelection(null);
  };

  const commentOnSelection = (at: LinePoint) => {
    const sel = isSelected(selection, at) ? selection! : select(at);
    commentOn(sel.file, selectionRange(sel));
  };

  const move = (e: KeyboardEvent, point: LinePoint) => {
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const points = nav.current?.pointsOf(point.file) ?? [];
    const next = neighbour(points, point, dir, e.shiftKey || split);
    if (!next) return;
    setSelection((sel) =>
      e.shiftKey ? extend(sel ?? select(point), next) : select(next)
    );
    nav.current?.focus(next);
  };

  const onKey = (e: KeyboardEvent, point: LinePoint) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(e, point);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commentOnSelection(point);
    } else if (e.key === 'Escape' && selection) {
      e.stopPropagation();
      setSelection(null);
    }
  };

  const range = selection ? selectionRange(selection) : null;
  const end: LinePoint | null =
    selection && range
      ? { file: selection.file, side: selection.side, line: range.end }
      : null;

  /** The gutter for `point`; `first` is its file's first line, the tab
   *  stop while nothing in the file is selected. */
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
    onPoint: (p, extending) =>
      setSelection((sel) => (extending ? extend(sel, p) : select(p))),
    onKey,
    onComment: () => commentOnSelection(point),
  });

  const scope: MyDraftsScope = {
    ref,
    editing,
    setEditing,
    dropFresh: (key) => setFresh((f) => f.filter((t) => t.key !== key)),
    linesOf: (path) => linesByFile.get(path),
  };

  return { mineByFile, scope, gutterFor, commentOn, nav };
}
