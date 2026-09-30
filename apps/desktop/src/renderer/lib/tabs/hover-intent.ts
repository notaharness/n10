/*
 * When a pointer has settled on an element, decided the way Brian
 * Cherne's hoverIntent jQuery plugin decides it (v1.10.2,
 * github.com/briancherne/jquery-hoverIntent, `jquery.hoverIntent.js`),
 * reimplemented here without jQuery. These are its defaults (`_cfg`).
 */
/** How often the pointer's position is sampled while it is over the
 *  element. */
export const HOVER_INTENT_INTERVAL_MS = 100;
/** How far the pointer may have moved since the last sample, in px of
 *  straight-line distance, and still count as settled. */
export const HOVER_INTENT_SENSITIVITY_PX = 6;

export interface Point {
  x: number;
  y: number;
}

/**
 * From the moment the pointer comes over an element, its position is
 * sampled every interval; once it has moved less than the sensitivity
 * since the previous sample, it has settled, and the `settled` given
 * to `enter` is called once. A pointer crossing the element faster
 * than that (60 px/s) never settles, however long the crossing takes;
 * one slowing to a stop settles within an interval or two, whether or
 * not it is perfectly still.
 */
export class HoverIntent {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private previous: Point = { x: 0, y: 0 };
  private current: Point = { x: 0, y: 0 };
  private settled: () => void = () => undefined;

  /** Whether the pointer is being sampled: it came over the element
   *  and has neither settled nor been cancelled since. */
  get sampling(): boolean {
    return this.timer !== null;
  }

  /** The pointer came over the element, at `at`; call `settled` once
   *  it has settled there. */
  enter(at: Point, settled: () => void): void {
    this.cancel();
    this.settled = settled;
    this.previous = at;
    this.current = at;
    this.schedule();
  }

  /** The pointer moved to `at`, over the element. */
  move(at: Point): void {
    this.current = at;
  }

  /** Stop sampling: the pointer left, or something else won. */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.compare(), HOVER_INTENT_INTERVAL_MS);
  }

  private compare(): void {
    this.timer = null;
    const moved = Math.hypot(
      this.previous.x - this.current.x,
      this.previous.y - this.current.y
    );
    if (moved < HOVER_INTENT_SENSITIVITY_PX) {
      this.settled();
      return;
    }
    this.previous = this.current;
    this.schedule();
  }
}
