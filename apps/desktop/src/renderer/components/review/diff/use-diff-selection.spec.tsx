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
/** Each token keyed by its offset, as the rows key them. */
const TOKENS = ['const', ' ', 'something', ' = ', 'useSomething', '();'].map(
  (content, i, all) => ({ content, start: all.slice(0, i).join('').length })
);

/** One diff line, as plain text until its syntax tokens land; the
 *  selection's term is reported back the way the rows mark it. */
function Diff({ tokens }: { tokens: boolean }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const term = useDiffSelection(scrollRef);
  return (
    <div ref={scrollRef} data-term={term}>
      <span data-diff-code>
        {tokens
          ? TOKENS.map((t) => <span key={t.start}>{t.content}</span>)
          : LINE}
      </span>
    </div>
  );
}

describe('useDiffSelection', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Diff tokens={false} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    getSelection()?.removeAllRanges();
  });

  /** Selects "something", the first word after "const ". */
  function select() {
    const text = container.querySelector('[data-diff-code]')?.firstChild;
    if (!text) throw new Error('no line text');
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 15);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }

  /** happy-dom leaves a range on the nodes React removed, where
   *  Chromium collapses it: read it only while it is in the document. */
  const selected = () => {
    const selection = getSelection();
    return selection?.anchorNode?.isConnected &&
      selection.focusNode?.isConnected
      ? selection.toString()
      : '';
  };

  const term = () =>
    container.querySelector('[data-term]')?.getAttribute('data-term');

  it('keeps a selection whose line gets its syntax tokens after mouseup', async () => {
    select();
    await act(async () => document.dispatchEvent(new MouseEvent('mouseup')));
    expect(term()).toBe('something');

    await act(async () => root.render(<Diff tokens />));
    expect(selected()).toBe('something');
    expect(term()).toBe('something');
  });

  it('keeps a drag whose line gets its syntax tokens before mouseup', async () => {
    select();
    await act(async () => root.render(<Diff tokens />));
    await act(async () => document.dispatchEvent(new MouseEvent('mouseup')));

    expect(selected()).toBe('something');
    expect(term()).toBe('something');
  });
});
