import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

interface CodeSelection {
  term: string;
  code: HTMLElement;
  start: number;
  end: number;
}

function codeSelection(root: HTMLElement): CodeSelection | null {
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
  const term = selection.toString().trim();
  if (term.length < 3 || term.length > 80 || /\s/.test(term)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(code);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { term, code, start, end: start + selection.toString().length };
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

/** Keep the browser's native selection while React inserts match marks. */
export function useDiffSelection(
  scrollRef: RefObject<HTMLDivElement | null>
): string {
  const [selected, setSelected] = useState<CodeSelection | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const capture = () => {
      const root = scrollRef.current;
      if (!root) return;
      const next = codeSelection(root);
      if (next) {
        setSelected((current) =>
          current?.term === next.term &&
          current.code === next.code &&
          current.start === next.start &&
          current.end === next.end
            ? current
            : next
        );
      }
    };
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(capture, 80);
    };
    const pointerDown = (event: PointerEvent) => {
      if (scrollRef.current?.contains(event.target as Node)) setSelected(null);
    };
    const mouseUp = () => {
      clearTimeout(timer);
      capture();
    };
    document.addEventListener('pointerdown', pointerDown);
    document.addEventListener('mouseup', mouseUp);
    document.addEventListener('selectionchange', changed);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', pointerDown);
      document.removeEventListener('mouseup', mouseUp);
      document.removeEventListener('selectionchange', changed);
    };
  }, [scrollRef]);

  useLayoutEffect(() => {
    if (!selected || !selected.code.isConnected) return;
    const start = positionAt(selected.code, selected.start);
    const end = positionAt(selected.code, selected.end);
    if (!start || !end) return;
    const range = document.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    const selection = window.getSelection();
    if (selection?.toString() === range.toString()) return;
    selection?.removeAllRanges();
    selection?.addRange(range);
  }, [selected]);

  return selected?.term ?? '';
}
