import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  dropLeading,
  frontCut,
  type LabelPart,
} from '../../lib/tabs/front-truncate.js';
import { repoDisplayName } from '../../lib/tabs/tab-presentation.js';
import { cn } from '../../lib/utils.js';

let canvas: CanvasRenderingContext2D | null = null;

/** Widths as the page's own text engine lays the string out. */
function measurer(font: string): (s: string) => number {
  canvas ??= document.createElement('canvas').getContext('2d');
  const ctx = canvas;
  if (!ctx) return (s) => s.length;
  ctx.font = font;
  return (s) => ctx.measureText(s).width;
}

/** Bumped as web fonts finish loading: the same font names then
 *  measure differently. */
const fonts = { loaded: 0 };

function watchFonts(changed: () => void): () => void {
  const loaded = () => {
    fonts.loaded += 1;
    changed();
  };
  document.fonts.addEventListener('loadingdone', loaded);
  return () => document.fonts.removeEventListener('loadingdone', loaded);
}

/**
 * The box a label has to fit in, as `width\nfont\nfonts-loaded`: what
 * the cut depends on, read from the element and re-read when it
 * resizes or a font arrives.
 */
function useTextBox(el: HTMLElement | null): string {
  const subscribe = useCallback(
    (changed: () => void) => {
      if (!el) return () => undefined;
      const resized = new ResizeObserver(changed);
      resized.observe(el);
      const unwatch = watchFonts(changed);
      return () => {
        resized.disconnect();
        unwatch();
      };
    },
    [el]
  );
  // The exact width: the tab is as wide as its whole label, to the
  // fraction of a pixel, and `clientWidth` would round that down into
  // an overflow.
  return useSyncExternalStore(subscribe, () =>
    el
      ? `${el.getBoundingClientRect().width}\n${getComputedStyle(el).font}\n${
          fonts.loaded
        }`
      : ''
  );
}

/** What canvas and layout may disagree by on one string's width. */
const MEASURE_SLACK_PX = 0.5;

/** The label's runs cut from the front to fit the box, or whole until
 *  it has been measured. */
function fitted(parts: LabelPart[], box: string): LabelPart[] {
  if (!box) return parts;
  const [width = '0', font = ''] = box.split('\n');
  const text = parts.map((p) => p.text).join('');
  const room = Number(width) + MEASURE_SLACK_PX;
  return dropLeading(parts, frontCut(text, room, measurer(font)));
}

/**
 * The tab's title, prefixed with its repository when that is not the
 * open one — the strip spans repos, and `main` alone says nothing about
 * which checkout it is. Too long for the tab, it loses its front, so the
 * end of the branch stays in view.
 *
 * Three layers: the whole label, hidden, sizes the tab as the text
 * would; the cut one is painted over it; and a screen reader reads the
 * whole label, never the cut.
 */
export function TabLabel({
  label,
  preview,
  foreignRepo,
}: {
  label: string;
  preview: boolean;
  foreignRepo: string | null;
}) {
  const [el, setEl] = useState<HTMLSpanElement | null>(null);
  const box = useTextBox(el);
  const parts: LabelPart[] = foreignRepo
    ? [
        {
          key: 'repo',
          text: `${repoDisplayName(foreignRepo)}/`,
          className: 'text-muted-foreground/70',
        },
        { key: 'label', text: label },
      ]
    : [{ key: 'label', text: label }];
  const whole = parts.map((p) => p.text).join('');
  return (
    <span
      ref={setEl}
      data-tab-label
      className={cn(
        'relative min-w-0 flex-1 overflow-hidden whitespace-nowrap',
        preview && 'italic'
      )}
    >
      <span aria-hidden className="invisible">
        {whole}
      </span>
      <span aria-hidden data-tab-label-shown className="absolute inset-0">
        {fitted(parts, box).map((p) => (
          <span key={p.key} className={p.className}>
            {p.text}
          </span>
        ))}
      </span>
      <span className="sr-only">{whole}</span>
    </span>
  );
}
