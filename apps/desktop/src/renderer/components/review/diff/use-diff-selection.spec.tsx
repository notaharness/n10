// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDiffSelection } from './use-diff-selection.js';

declare global {
  // The flag React's act() reads.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const LINE = 'const something = useSomething();';

/** A line's syntax tokens, each keyed by its offset as the rows key them. */
const tokensOf = (line: string) =>
  line
    .split(/(\W+)/)
    .filter(Boolean)
    .map((content, i, all) => ({
      content,
      start: all.slice(0, i).join('').length,
    }));

/** One diff line, as plain text until its syntax tokens land; the
 *  selection's term is reported back the way the rows mark it. */
function Diff({ tokens, line = LINE }: { tokens: boolean; line?: string }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const term = useDiffSelection(scrollRef);
  return (
    <div ref={scrollRef} data-term={term}>
      <span data-diff-code>
        {tokens
          ? tokensOf(line).map((t) => <span key={t.start}>{t.content}</span>)
          : line}
      </span>
    </div>
  );
}

describe('useDiffSelection', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Diff tokens={false} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    getSelection()?.removeAllRanges();
  });

  /** Selects "something", the first word after "const ", from its start
   *  to its end, or backward as a right-to-left drag does. */
  function select(backward = false) {
    const text = container.querySelector('[data-diff-code]')?.firstChild;
    if (!text) throw new Error('no line text');
    const [anchor, focus] = backward ? [15, 6] : [6, 15];
    getSelection()?.setBaseAndExtent(text, anchor, text, focus);
    document.dispatchEvent(new Event('selectionchange'));
  }

  const mouseUp = () =>
    act(async () => document.dispatchEvent(new MouseEvent('mouseup')));

  const tokensLand = (line?: string) =>
    act(async () => root.render(<Diff tokens line={line} />));

  /** happy-dom leaves a range on the nodes React removed, where
   *  Chromium collapses it: read it only while it is in the document. */
  const selected = () => {
    const selection = getSelection();
    return selection?.anchorNode?.isConnected &&
      selection.focusNode?.isConnected
      ? selection.toString()
      : '';
  };

  const backward = () => {
    const selection = getSelection();
    if (!selection?.rangeCount) return false;
    const range = selection.getRangeAt(0);
    return (
      selection.anchorNode === range.endContainer &&
      selection.anchorOffset === range.endOffset
    );
  };

  const term = () =>
    container.querySelector('[data-term]')?.getAttribute('data-term');

  it('keeps a selection whose line gets its syntax tokens after mouseup', async () => {
    select();
    await mouseUp();
    expect(term()).toBe('something');

    await tokensLand();
    expect(selected()).toBe('something');
    expect(backward()).toBe(false);
    expect(term()).toBe('something');
  });

  it('keeps a drag whose line gets its syntax tokens before mouseup', async () => {
    select();
    await tokensLand();
    await mouseUp();

    expect(selected()).toBe('something');
    expect(term()).toBe('something');
  });

  it('keeps a backward selection backward', async () => {
    select(true);
    await tokensLand();

    expect(selected()).toBe('something');
    expect(backward()).toBe(true);
  });

  it('leaves a selection the reader cleared', async () => {
    select();
    await mouseUp();
    getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));

    await tokensLand();
    expect(selected()).toBe('');
  });

  it.each([
    ['inside', () => container.querySelector('[data-diff-code]')],
    ['outside', () => document.body],
  ])('leaves a selection after a press %s the diff', async (_, target) => {
    select();
    await mouseUp();
    await act(async () =>
      target()?.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true })
      )
    );

    await tokensLand();
    expect(selected()).toBe('');
  });

  it('leaves a selection made elsewhere before its selectionchange', async () => {
    select();
    await mouseUp();
    const elsewhere = document.createElement('p');
    elsewhere.textContent = 'elsewhere';
    document.body.append(elsewhere);
    const text = elsewhere.firstChild;
    if (!text) throw new Error('no text');
    // Chromium reports the change a task later; hold it back past the render.
    const late = (event: Event) => event.stopImmediatePropagation();
    document.addEventListener('selectionchange', late, true);
    getSelection()?.setBaseAndExtent(text, 0, text, 4);

    await tokensLand();
    document.removeEventListener('selectionchange', late, true);
    expect(selected()).toBe('else');
    elsewhere.remove();
  });

  it('leaves a selection whose line a refresh rewrote', async () => {
    select();
    await mouseUp();

    await tokensLand('let other = useSomethingElse();');
    expect(selected()).toBe('');
  });
});
