import {
  boxFaces,
  inQuad,
  onLeft,
  onRight,
  project,
  toPoints,
  type Box,
  type Vec3,
} from '../../lib/fleet/isometric.js';

/**
 * Two machines of the website's beam mesh, a laptop and a tower, joined
 * by one beam arcing between them, with traffic both ways. Machines and the beam's colour
 * follow the website (apps/website/src/components/beam/mesh); surfaces
 * come from the app's theme tokens (`.fleet-art` in styles.css).
 */

/** Ground distance along each axis between the two machines' centres. */
const SPAN = 4.2;
/** How far each direction's track sits from the beam's centre line. */
const LANE = 0.18;

function Faces({ box }: { box: Box }) {
  return (
    <g>
      {boxFaces(box).map((face) => (
        <polygon
          key={face.tone}
          points={face.points}
          className={`fleet-art-face fleet-art-face--${face.tone}`}
        />
      ))}
    </g>
  );
}

function Shadow({ box }: { box: Box }) {
  const grow = 0.18;
  return (
    <polygon
      className="fleet-art-shadow"
      points={toPoints([
        [box.x - grow, box.y - grow, 0],
        [box.x + box.w + grow, box.y - grow, 0],
        [box.x + box.w + grow, box.y + box.d + grow, 0],
        [box.x - grow, box.y + box.d + grow, 0],
      ])}
    />
  );
}

function Tower({ cx, cy }: { cx: number; cy: number }) {
  const body: Box = { x: cx - 0.75, y: cy - 1.3, z: 0, w: 1.5, d: 2.6, h: 3 };
  return (
    <g>
      <Shadow box={body} />
      <Faces box={body} />
      {[0.14, 0.22, 0.3, 0.38, 0.46].map((v) => (
        <polygon
          key={v}
          points={onRight(body, 0.18, v, 0.82, v + 0.035)}
          className="fleet-art-inset"
        />
      ))}
      {[
        [0.62, 0.68],
        [0.5, 0.56],
        [0.08, 0.3],
      ].map(([v0, v1]) => (
        <polygon
          key={v0}
          points={onLeft(body, 0.2, v0 as number, 0.8, v1 as number)}
          className="fleet-art-inset"
        />
      ))}
      <polygon
        points={onLeft(body, 0.42, 0.84, 0.58, 0.9)}
        className="fleet-art-led"
      />
    </g>
  );
}

const CODE_LINES = [
  { v: 0.2, u0: 0.14, u1: 0.56, tone: 'sage' },
  { v: 0.305, u0: 0.2, u1: 0.78, tone: 'sand' },
  { v: 0.41, u0: 0.2, u1: 0.5, tone: 'sage' },
  { v: 0.515, u0: 0.26, u1: 0.68, tone: 'muted' },
  { v: 0.62, u0: 0.2, u1: 0.44, tone: 'sand' },
  { v: 0.725, u0: 0.14, u1: 0.36, tone: 'sage' },
] as const;

function Laptop({ cx, cy }: { cx: number; cy: number }) {
  const base: Box = { x: cx - 1.5, y: cy - 0.8, z: 0, w: 3, d: 2, h: 0.14 };
  const deck = base.z + base.h;
  const lid: readonly [Vec3, Vec3, Vec3, Vec3] = [
    [base.x, base.y - 0.55, deck + 1.85],
    [base.x + base.w, base.y - 0.55, deck + 1.85],
    [base.x + base.w, base.y + 0.06, deck],
    [base.x, base.y + 0.06, deck],
  ];
  const display = [
    inQuad(lid, 0.05, 0.07),
    inQuad(lid, 0.95, 0.07),
    inQuad(lid, 0.95, 0.9),
    inQuad(lid, 0.05, 0.9),
  ];
  return (
    <g>
      <Shadow box={base} />
      <Faces box={base} />
      <polygon
        points={toPoints([
          [base.x + 0.3, base.y + 0.35, deck],
          [base.x + base.w - 0.3, base.y + 0.35, deck],
          [base.x + base.w - 0.3, base.y + 1.2, deck],
          [base.x + 0.3, base.y + 1.2, deck],
        ])}
        className="fleet-art-inset"
      />
      <polygon
        points={toPoints(lid)}
        className="fleet-art-face fleet-art-face--left"
      />
      <polygon points={toPoints(display)} className="fleet-art-screen" />
      {CODE_LINES.map(({ v, u0, u1, tone }) => (
        <polyline
          key={v}
          points={toPoints([inQuad(lid, u0, v), inQuad(lid, u1, v)])}
          className={`fleet-art-code fleet-art-code--${tone}`}
        />
      ))}
    </g>
  );
}

/** Heights of the beam's ends (laptop deck, tower side) and of its arc's control point. */
const RISE = { from: 0.14, to: 1.2, peak: 5 } as const;

/**
 * One direction's track from the laptop (0, SPAN) to the tower
 * (SPAN, 0), moved `offset` toward the viewer: a parabola in the
 * vertical plane between them, which the projection keeps a quadratic
 * curve on screen.
 */
function Track({ offset, back }: { offset: number; back?: boolean }) {
  const mid = SPAN / 2 + offset;
  const [from, control, to] = [
    [offset, SPAN + offset, RISE.from],
    [mid, mid, RISE.peak],
    [SPAN + offset, offset, RISE.to],
  ].map((p) => project(p as unknown as Vec3).join(','));
  const d = `M${from} Q${control} ${to}`;
  return (
    <g>
      <path d={d} className="fleet-art-ribbon" />
      <path
        d={d}
        pathLength={100}
        className={
          back ? 'fleet-art-packet fleet-art-packet--back' : 'fleet-art-packet'
        }
      />
    </g>
  );
}

export function FleetIllustration() {
  return (
    <svg
      viewBox="-157 -56 301 149"
      className="fleet-art h-auto w-48 overflow-visible"
      aria-hidden
    >
      <Track offset={-LANE} />
      <Track offset={LANE} back />
      <Laptop cx={0} cy={SPAN} />
      <Tower cx={SPAN} cy={0} />
    </svg>
  );
}
