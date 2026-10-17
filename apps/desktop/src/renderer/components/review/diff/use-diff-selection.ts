import { useEffect, useState, type RefObject } from 'react';

/** A selection inside one line, as character offsets into its code. */
interface LineRange {
  code: HTMLElement;
  start: number;
  end: number;
}

interface CodeSelection extends LineRange {
  term: string;
}

function lineRange(root: HTMLElement): LineRange | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return null;
  const range = selection.getRangeAt(0);
  const code =
    range.startContainer.parentElement?.closest<HTMLElement>(
      '[data-diff-code]'
    );
  if (!code || !root.contains(code) || !code.contains(range.endContainer))
    return null;
  const before = range.cloneRange();
  before.selectNodeContents(code);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { code, start, end: start + selection.toString().length };
}

function codeSelection(line: LineRange | null): CodeSelection | null {
  const term = window.getSelection()?.toString().trim() ?? '';
  if (!line || term.length < 3 || term.length > 80 || /\s/.test(term))
    return null;
  return { ...line, term };
}

function sameRange(a: LineRange | null, b: LineRange | null): boolean {
  return a?.code === b?.code && a?.start === b?.start && a?.end === b?.end;
}

function positionAt(code: HTMLElement, offset: number): [Node, number] | null {
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let left = offset;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.textContent?.length ?? 0;
    if (left <= length) return [node, left];
    left -= length;
  }
  return null;
}

function restore(root: HTMLElement, line: LineRange) {
  if (!line.code.isConnected || sameRange(lineRange(root), line)) return;
  const start = positionAt(line.code, line.start);
  const end = positionAt(line.code, line.end);
  if (!start || !end) return;
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

/**
 * Keep the browser's native selection while React re-renders its line:
 * match marks going in, or syntax tokens landing after the drag that
 * made it. Either replaces the text nodes the selection sits in.
 */
export function useDiffSelection(
  scrollRef: RefObject<HTMLDivElement | null>
): string {
  const [selected, setSelected] = useState<CodeSelection | null>(null);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let held: LineRange | null = null;
    const capture = () => {
      held = lineRange(root);
      const next = codeSelection(held);
      if (next) {
        setSelected((current) => (sameRange(current, next) ? current : next));
      }
    };
    const changed = () => {
      held = lineRange(root);
      clearTimeout(timer);
      timer = setTimeout(capture, 80);
    };
    const pointerDown = (event: PointerEvent) => {
      if (!root.contains(event.target as Node)) return;
      held = null;
      setSelected(null);
    };
    const mouseUp = () => {
      clearTimeout(timer);
      capture();
    };
    // Microtasks run after React's commit and before paint.
    const rerendered = new MutationObserver((records) => {
      const line = held;
      if (line && records.some((r) => line.code.contains(r.target)))
        restore(root, line);
    });
    rerendered.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('mouseup', mouseUp);
    document.addEventListener('selectionchange', changed);
    return () => {
      clearTimeout(timer);
      rerendered.disconnect();
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('mouseup', mouseUp);
      document.removeEventListener('selectionchange', changed);
    };
  }, [scrollRef]);

  return selected?.term ?? '';
}
