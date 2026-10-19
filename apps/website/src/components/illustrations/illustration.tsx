'use client';

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Board } from './parts';
import './illustrations.css';

/** Every illustration's frame, so pieces in a row match exactly. */
const W = 640;
const H = 400;
/** Where each drawing's content box lands: centred, with equal padding. */
const PAD = 48;

/** [x, y, width, height] of a drawing's final composition, in its own units. */
export type Box = readonly [number, number, number, number];

/**
 * Scales and centres a content box into the shared safe area, so every
 * piece fills its frame to the same degree whatever coordinates it was
 * drawn in. The scale is also exposed as `--fit`, which label sizes
 * divide by so type renders alike in every piece.
 */
function fit([x, y, w, h]: Box, height: number, pad: number) {
  const s = Math.min((W - pad * 2) / w, (height - pad * 2) / h);
  const r = (n: number) => +n.toFixed(3);
  return {
    transform: `translate(${r(W / 2 - s * (x + w / 2))} ${r(
      height / 2 - s * (y + h / 2)
    )}) scale(${r(s)})`,
    style: { '--fit': r(s) } as CSSProperties,
  };
}

function motionAllowed(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The frame every homepage illustration shares: a fixed-ratio board, the
 * drawing fitted into it, the drawing's accessible name, and playback.
 *
 * The server renders the final composition. Only when motion is allowed
 * does the client mark the piece `data-anim="ready"` (paused on frame
 * zero, which is offscreen at that point), switch it to `play` once it is
 * mostly in view, and pause it again whenever it scrolls out. The
 * sequence loops: its clock runs past the last beat to hold the final
 * frame, then the drawing fades out, restarts from frame zero and fades
 * back in.
 *
 * A piece that stands alone in its own frame, rather than in a row, may
 * set its own height and padding, and draw a backdrop in place of the
 * board. The backdrop is fitted with the drawing but doesn't fade.
 */
export function Illustration({
  name,
  box,
  height = H,
  pad = PAD,
  backdrop,
  title,
  description,
  css,
  children,
}: {
  /** Scopes the piece's keyframes; matches the `timeline()` name. */
  name: string;
  box: Box;
  height?: number;
  pad?: number;
  backdrop?: ReactNode;
  title: string;
  description: string;
  /** Output of `timeline()`, or omitted for a static piece. */
  css?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const art = useRef<SVGGElement>(null);
  const id = useId();

  useEffect(() => {
    const el = ref.current;
    const drawing = art.current;
    if (!el || !drawing || !css || !motionAllowed()) return;
    el.dataset.anim = 'ready';
    el.dataset.vis = '0';
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        el.dataset.vis = entry.isIntersecting ? '1' : '0';
        if (entry.intersectionRatio >= 0.45 && el.dataset.anim === 'ready')
          el.dataset.anim = 'play';
      },
      { threshold: [0, 0.45] }
    );
    const onEnd = (e: AnimationEvent) => {
      if (e.animationName === `${name}-clock`) el.dataset.fade = '';
    };
    const onFaded = (e: TransitionEvent) => {
      if (e.target !== drawing || !('fade' in el.dataset)) return;
      // Dropping the attribute removes the animations; a reflow before
      // restoring it starts them again from zero, still faded out.
      delete el.dataset.anim;
      void el.offsetWidth;
      el.dataset.anim = 'play';
      delete el.dataset.fade;
    };
    observer.observe(el);
    el.addEventListener('animationend', onEnd);
    drawing.addEventListener('transitionend', onFaded);
    return () => {
      observer.disconnect();
      el.removeEventListener('animationend', onEnd);
      drawing.removeEventListener('transitionend', onFaded);
    };
  }, [css, name]);

  return (
    <div
      ref={ref}
      className="ill"
      data-ill={name}
      style={{ aspectRatio: `${W} / ${height}` }}
    >
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <svg
        viewBox={`0 0 ${W} ${height}`}
        role="img"
        aria-labelledby={`${id}-t ${id}-d`}
      >
        <title id={`${id}-t`}>{title}</title>
        <desc id={`${id}-d`}>{description}</desc>
        {backdrop ? (
          <g aria-hidden {...fit(box, height, pad)}>
            {backdrop}
          </g>
        ) : (
          <Board width={W} height={height} />
        )}
        <g ref={art} className="ill-art" {...fit(box, height, pad)}>
          {children}
        </g>
        {css && <rect className="ill-clock" width="0" height="0" />}
      </svg>
    </div>
  );
}
