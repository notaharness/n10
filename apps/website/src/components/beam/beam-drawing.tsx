import type { CSSProperties, ReactNode } from 'react';
import { BEAM_COLORS } from './mesh/palette';

export function Track({
  d,
  color = BEAM_COLORS.sage,
  pending = false,
}: {
  d: string;
  color?: string;
  pending?: boolean;
}) {
  return (
    <g
      style={
        {
          '--n10-mesh-color': color,
          '--n10-mesh-seconds': '6s',
        } as CSSProperties
      }
    >
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeDasharray={pending ? '4 5' : undefined}
        opacity={0.5}
      />
      {!pending && <path d={d} pathLength={100} className="n10-mesh-packet" />}
    </g>
  );
}

export function Label({
  x,
  y,
  children,
  muted = false,
}: {
  x: number;
  y: number;
  children: ReactNode;
  muted?: boolean;
}) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      fontSize={15}
      className={muted ? 'fill-fd-muted-foreground' : 'fill-fd-foreground'}
    >
      {children}
    </text>
  );
}

export function Key({
  x,
  y,
  color = BEAM_COLORS.sand,
}: {
  x: number;
  y: number;
  color?: string;
}) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={0} cy={0} r={9} />
      <path d="M9 0H35V7M26 0V5" />
    </g>
  );
}

export function Lock({ x, y }: { x: number; y: number }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      stroke="var(--color-fd-primary)"
      strokeWidth={1.5}
    >
      <path d="M-6 0V-6a6 6 0 0 1 12 0V0" fill="none" />
      <rect
        x={-10}
        y={0}
        width={20}
        height={16}
        rx={3}
        fill="var(--color-fd-background)"
      />
      <path d="M0 5V10" />
    </g>
  );
}

export function Browser({ x, y }: { x: number; y: number }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      stroke="var(--color-fd-border)"
      strokeWidth={1.5}
    >
      <rect
        x={-32}
        y={-25}
        width={64}
        height={50}
        rx={5}
        fill="var(--color-fd-card)"
      />
      <path d="M-32-13H32" />
      <circle
        cx={-23}
        cy={-19}
        r={1.5}
        fill="var(--color-fd-muted-foreground)"
        stroke="none"
      />
      <path d="M-17 2H17M-17 11H5" stroke="var(--color-fd-primary)" />
    </g>
  );
}
