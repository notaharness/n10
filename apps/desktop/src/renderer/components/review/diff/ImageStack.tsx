import { GripVertical } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { IMAGE_FRAME_HEIGHT } from '../../../lib/diff/diff-bodies.js';
import type { ImageSide } from '../../../lib/diff/image-side.js';
import { usePrefersReducedMotion } from '../../../lib/reduced-motion.js';
import { Button } from '../../ui/button.js';
import { Slider, SliderThumb } from '../../ui/slider.js';
import {
  Frame,
  Layer,
  SideCaption,
  SideView,
  type ImageSizes,
} from './ImageSide.js';

/**
 * A changed image's two sides in one frame, one over the other: shown in
 * turn (toggle), or split by a divider the reader drags (slider). Both
 * sides stay mounted and decoded, so neither flashes as it comes back.
 */

export interface StackProps {
  cwd: string;
  before: ImageSide;
  after: ImageSide;
  sizes: ImageSizes;
  onSize: (oid: string, size: string) => void;
  inView: boolean;
  /** The choice of comparison, which heads the row. */
  modes: ReactNode;
}

/** How long each side shows before the other takes its place. */
const TOGGLE_MS = 1_000;

const otherSide = (side: ImageSide['key']): ImageSide['key'] =>
  side === 'before' ? 'after' : 'before';

/** The row's top line: the choice of comparison and what goes with it. */
export function ModesLine({ children }: { children: ReactNode }) {
  return <div className="mb-2 flex h-7 items-center gap-2">{children}</div>;
}

/** The sides in turn, each about a second. Under reduced motion the
 *  frame holds still and the reader flips it. */
export function ToggleCompare(props: StackProps) {
  const { cwd, before, after, sizes, onSize, inView, modes } = props;
  const still = usePrefersReducedMotion();
  const [showing, setShowing] = useState<ImageSide['key']>('before');
  const flip = () => setShowing(otherSide);
  useEffect(() => {
    if (still) return;
    const timer = setInterval(() => setShowing(otherSide), TOGGLE_MS);
    return () => clearInterval(timer);
  }, [still]);
  const shown = showing === 'before' ? before : after;
  const other = showing === 'before' ? after : before;
  return (
    <>
      <ModesLine>
        {modes}
        {still && (
          <Button variant="ghost" size="sm" onClick={flip}>
            Show {other.label.toLowerCase()}
          </Button>
        )}
      </ModesLine>
      <figure data-image-toggle={showing} className="min-w-0">
        <figcaption className="mb-1.5 flex h-4 font-sans text-xs text-muted-foreground">
          <SideCaption side={shown} sizes={sizes} />
        </figcaption>
        <Frame>
          {[before, after].map((side) => (
            <Layer key={side.key} side={side.key} hidden={side.key !== showing}>
              <SideView cwd={cwd} side={side} inView={inView} onSize={onSize} />
            </Layer>
          ))}
        </Frame>
      </figure>
    </>
  );
}

/** Before on the left of the divider, after on its right. The divider
 *  is a slider's thumb: a press anywhere in the frame moves it there,
 *  and the arrows move it when focused. The thumb is as thin as the
 *  line, so the slider's keep-in-bounds nudge cannot pull it off the
 *  edge it reveals to; the grip hangs off it without widening it. */
export function SliderCompare(props: StackProps) {
  const { cwd, before, after, sizes, onSize, inView, modes } = props;
  const [at, setAt] = useState(50);
  return (
    <>
      <ModesLine>{modes}</ModesLine>
      <figure data-image-slider className="min-w-0">
        <figcaption className="mb-1.5 flex h-4 justify-between gap-3 font-sans text-xs text-muted-foreground">
          <SideCaption side={before} sizes={sizes} />
          <SideCaption side={after} sizes={sizes} className="text-right" />
        </figcaption>
        <Frame>
          <Layer side="before">
            <SideView cwd={cwd} side={before} inView={inView} onSize={onSize} />
          </Layer>
          <Layer side="after" style={{ clipPath: `inset(0 0 0 ${at}%)` }}>
            <SideView cwd={cwd} side={after} inView={inView} onSize={onSize} />
          </Layer>
          <Slider
            className="absolute inset-0 cursor-ew-resize"
            min={0}
            max={100}
            step={1}
            value={[at]}
            onValueChange={([next]) => next !== undefined && setAt(next)}
          >
            <SliderThumb
              aria-label="Divider between before and after"
              aria-valuetext={`${at}% before, ${100 - at}% after`}
              className="relative w-0.5 bg-primary shadow"
              // The frame's inside: its height less its border.
              style={{ height: IMAGE_FRAME_HEIGHT - 2 }}
            >
              <span className="absolute top-1/2 left-1/2 flex size-6 -translate-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow">
                <GripVertical className="size-3.5" />
              </span>
            </SliderThumb>
          </Slider>
        </Frame>
      </figure>
    </>
  );
}
