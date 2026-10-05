import type { ReactNode } from 'react';
import { BEAM_COLORS } from '@/components/beam/mesh/palette';

/**
 * Flat drawings of a Claude Code terminal in fullscreen with the
 * Context Switcher sidebar docked on its right, shared by the hero's
 * animated scene and the how-it-works figures. Text is Geist Mono at
 * a size that stays legible when the scene shrinks to a phone.
 */
export const FONT = 13;
export const LINE = 22;

export const CONTEXT_COLORS = {
  main: 'var(--color-fd-primary)',
  ci: BEAM_COLORS.clay,
  tests: BEAM_COLORS.blue,
  changelog: BEAM_COLORS.mauve,
} as const;

export const NEEDS_YOU = BEAM_COLORS.sand;

export function Window({
  width,
  height,
  title = 'claude',
  children,
}: {
  width: number;
  height: number;
  title?: string;
  children: ReactNode;
}) {
  return (
    <g>
      {/* The edge and shadow are the frame's (`n10-frame`) around the svg. */}
      <rect width={width} height={height} fill="var(--color-fd-card)" />
      <path d={`M0 26.5H${width}`} stroke="var(--color-fd-border)" />
      {[16, 30, 44].map((cx) => (
        <circle
          key={cx}
          cx={cx}
          cy={13.5}
          r={4}
          fill="var(--color-fd-border)"
        />
      ))}
      <Mono x={width / 2} y={17.5} size={11} muted anchor="middle">
        {title}
      </Mono>
      {children}
    </g>
  );
}

export function Mono({
  x,
  y,
  children,
  size = FONT,
  muted = false,
  color,
  anchor,
  weight,
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  muted?: boolean;
  color?: string;
  anchor?: 'middle' | 'end';
  weight?: number;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      fontFamily="var(--font-mono)"
      fontWeight={weight}
      textAnchor={anchor}
      fill={color}
      className={
        color
          ? undefined
          : muted
          ? 'fill-fd-muted-foreground'
          : 'fill-fd-foreground'
      }
    >
      {children}
    </text>
  );
}

/** Lines of Claude's prose, as bars: what it says matters less than where. */
export function Bars({
  x,
  y,
  widths,
}: {
  x: number;
  y: number;
  widths: number[];
}) {
  const rows = widths.map((w, i) => ({ w, top: y - 8 + i * 16 }));
  return (
    <g>
      <circle cx={x + 4} cy={y - 4} r={3.5} className="fill-fd-foreground" />
      {rows.map(({ w, top }) => (
        <rect
          key={top}
          x={x + 16}
          y={top}
          width={w}
          height={7}
          rx={3.5}
          fill="var(--color-fd-muted-foreground)"
          opacity={0.35}
        />
      ))}
    </g>
  );
}

/** A Claude message as text, after Claude Code's ● marker. */
export function Said({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: ReactNode;
}) {
  return (
    <g>
      <circle cx={x + 4} cy={y - 4} r={3.5} className="fill-fd-foreground" />
      <Mono x={x + 16} y={y}>
        {children}
      </Mono>
    </g>
  );
}

export function You({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: ReactNode;
}) {
  return (
    <Mono x={x} y={y}>
      <tspan className="fill-fd-muted-foreground">❯ </tspan>
      {children}
    </Mono>
  );
}

/** Main chat's one-line pointer to an update posted elsewhere. */
export function Pointer({
  x,
  y,
  color,
  name,
  text,
}: {
  x: number;
  y: number;
  color: string;
  name: string;
  text: string;
}) {
  return (
    <Mono x={x} y={y} muted>
      <tspan fill={color}>→ {name}</tspan>: {text}
    </Mono>
  );
}

export function PromptBox({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  width: number;
  children?: ReactNode;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={30}
        rx={6}
        fill="var(--color-fd-background)"
        stroke="var(--color-fd-border)"
      />
      <Mono x={x + 10} y={y + 19.5} muted>
        ❯
      </Mono>
      {children}
    </g>
  );
}

export type Marker = { kind: 'unread'; count: number } | { kind: 'you' };

export function Badge({
  x,
  y,
  marker,
}: {
  /** Right edge. */
  x: number;
  y: number;
  marker: Marker;
}) {
  if (marker.kind === 'unread') {
    return (
      <g>
        <circle cx={x - 9} cy={y - 4.5} r={9} fill="var(--n10-sage)" />
        <Mono
          x={x - 9}
          y={y - 0.5}
          size={11}
          weight={700}
          anchor="middle"
          color="var(--color-fd-background)"
        >
          {marker.count}
        </Mono>
      </g>
    );
  }
  return (
    <g>
      <rect
        x={x - 58}
        y={y - 14}
        width={58}
        height={19}
        rx={9.5}
        fill={NEEDS_YOU}
      />
      <Mono
        x={x - 29}
        y={y - 0.5}
        size={9.5}
        weight={700}
        anchor="middle"
        color="#15160f"
      >
        needs you
      </Mono>
    </g>
  );
}

/** One entry in the sidebar: a colour, a name and its marker. */
export function ContextRow({
  x,
  y,
  width,
  color,
  name,
  selected = false,
  marker,
}: {
  x: number;
  y: number;
  width: number;
  color: string;
  name: string;
  selected?: boolean;
  marker?: ReactNode;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y - 17}
        width={width}
        height={26}
        rx={5}
        fill="var(--color-fd-accent)"
        opacity={selected ? 1 : 0}
      />
      <circle cx={x + 12} cy={y - 4.5} r={4} fill={color} />
      <Mono x={x + 24} y={y} weight={selected ? 600 : undefined}>
        {name}
      </Mono>
      {marker}
    </g>
  );
}
