import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';

type Point = readonly [number, number];

/**
 * The drawing board: the page's grid at the artboard's 24-unit module,
 * centred so it leaves equal margins, inside a quiet border.
 */
export function Board({ width, height }: { width: number; height: number }) {
  const ox = (width % 24) / 2;
  const oy = (height % 24) / 2;
  let d = '';
  for (let x = ox + 24; x < width - 1; x += 24) d += `M${x} 0V${height}`;
  for (let y = oy + 24; y < height - 1; y += 24) d += `M0 ${y}H${width}`;
  return (
    <g aria-hidden>
      <path className="grid" d={d} opacity="0.55" />
      <rect
        className="frame"
        x="0.5"
        y="0.5"
        width={width - 1}
        height={height - 1}
      />
    </g>
  );
}

/**
 * An orthogonal connector with a 5-unit arrowhead whose tip sits on the
 * last point. The line stops short of the tip so its end can't poke
 * through the head.
 */
export function Connector({
  points,
  primary = false,
  dashed = false,
  head = true,
  className,
}: {
  points: readonly Point[];
  primary?: boolean;
  dashed?: boolean;
  head?: boolean;
  className?: string;
}) {
  const tip = points[points.length - 1]!;
  const prev = points[points.length - 2]!;
  const len = Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) || 1;
  const ux = (tip[0] - prev[0]) / len;
  const uy = (tip[1] - prev[1]) / len;
  const size = 5;
  const end: Point = head
    ? [tip[0] - ux * size * 0.8, tip[1] - uy * size * 0.8]
    : tip;
  const line = [...points.slice(0, -1), end].map((p) => p.join(',')).join(' ');
  const back: Point = [tip[0] - ux * size * 1.3, tip[1] - uy * size * 1.3];
  const arrow = [
    tip,
    [back[0] - uy * size, back[1] + ux * size],
    [back[0] + uy * size, back[1] - ux * size],
  ]
    .map((p) => p.join(','))
    .join(' ');
  return (
    <g className={className}>
      <polyline
        points={line}
        className={`${primary ? 'wire-primary' : 'wire'}${
          dashed ? ' wire-dash' : ''
        }`}
        strokeLinejoin="round"
      />
      {head && (
        <polygon points={arrow} className={primary ? 'head-primary' : 'head'} />
      )}
    </g>
  );
}

/** A pointer: the person doing the deliberate step. Tip at (x, y). */
export function Pointer({
  x,
  y,
  className,
}: {
  x: number;
  y: number;
  className?: string;
}) {
  return (
    <g className={className}>
      <path
        className="pointer o2"
        d={`M${x} ${y}l0 19l5 -4.6l3.6 8l3.2 -1.4l-3.5 -7.8l6.9 0z`}
      />
    </g>
  );
}

/**
 * An n10 window: a surface with a title strip carrying the real mark, or
 * `title` in its place where the window must be named at every size.
 * Children are drawn inside, below the strip.
 */
export function N10Window({
  x,
  y,
  width,
  height,
  label,
  title,
  children,
  className,
  strip = 28,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  title?: string;
  children?: ReactNode;
  className?: string;
  strip?: number;
}) {
  const markH = strip * 0.42;
  return (
    <g className={className}>
      <rect
        className="surface o"
        x={x}
        y={y}
        width={width}
        height={height}
        rx="3"
      />
      <line
        className="o2"
        stroke="var(--ill-rule)"
        x1={x}
        x2={x + width}
        y1={y + strip}
        y2={y + strip}
      />
      {title ? (
        <text className="t1" x={x + 12} y={y + strip / 2 + 7}>
          {title}
        </text>
      ) : (
        <Logo
          aria-hidden
          x={x + 12}
          y={y + (strip - markH) / 2}
          height={markH}
          width={markH * 1.75}
        />
      )}
      {label && (
        <text
          className="t2 mono"
          x={x + 20 + markH * 1.75}
          y={y + strip / 2 + 4.5}
        >
          {label}
        </text>
      )}
      {children}
    </g>
  );
}

/** Lines of placeholder prose: widths are fractions of `width`. */
export function Bars({
  x,
  y,
  width,
  widths,
  pitch = 12,
  h = 5,
  className = 'bar',
}: {
  x: number;
  y: number;
  width: number;
  widths: readonly number[];
  pitch?: number;
  h?: number;
  className?: string;
}) {
  return (
    <g>
      {widths
        .map((w, i) => ({ w, top: y + i * pitch }))
        .map(({ w, top }) => (
          <rect
            key={top}
            className={className}
            x={x}
            y={top}
            width={width * w}
            height={h}
            rx={h / 2}
          />
        ))}
    </g>
  );
}

/** A small check mark, centred on (x, y). */
export function Tick({
  x,
  y,
  s = 1,
  className,
}: {
  x: number;
  y: number;
  s?: number;
  className?: string;
}) {
  return (
    <path
      className={`tick ${className ?? ''}`}
      d={`M${x - 5 * s} ${y}l${3.5 * s} ${3.5 * s}l${6.5 * s} ${-7 * s}`}
    />
  );
}
