import {
  boxFaces,
  project,
  ribbon,
  shift,
  toPoints,
  type Box,
  type Vec2,
  type Vec3,
} from './geometry';

/** How far each direction's lane sits from a link's centre line. */
export const LANE = 0.18;

/** A ground path's points on screen, just above the ground. */
export function onScreen(path: readonly Vec2[]): Vec2[] {
  return path.map(([x, y]) => project([x, y, 0.02]));
}

/** One lane of a link, `side` −1 out from the laptop, +1 back to it. */
export function lane(path: readonly Vec2[], side: -1 | 1): Vec2[] {
  return shift(path, side * LANE);
}

/** The isometric ground's grid, fading out toward the frame's edges. */
export function Ground({
  centre,
  reach,
  radius,
}: {
  centre: number;
  reach: number;
  /** The fade's radii on screen. */
  radius: Vec2;
}) {
  const line = (a: Vec2, b: Vec2) => {
    const [x1, y1] = project([...a, 0]);
    const [x2, y2] = project([...b, 0]);
    return `M${x1} ${y1}L${x2} ${y2}`;
  };
  let d = '';
  for (let i = centre - reach; i <= centre + reach; i += 1) {
    d += line([i, centre - reach], [i, centre + reach]);
    d += line([centre - reach, i], [centre + reach, i]);
  }
  const [cx, cy] = project([centre, centre, 0]);
  const [rx, ry] = radius;
  return (
    <>
      <defs>
        <radialGradient
          id="beam-mesh-fade"
          gradientUnits="userSpaceOnUse"
          cx={cx}
          cy={cy}
          r="1"
          gradientTransform={`translate(${cx} ${cy}) scale(${rx} ${ry}) translate(${-cx} ${-cy})`}
        >
          <stop offset="0.45" stopColor="white" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
        <mask
          id="beam-mesh-mask"
          maskUnits="userSpaceOnUse"
          x={cx - rx}
          y={cy - ry}
          width={rx * 2}
          height={ry * 2}
        >
          <rect
            x={cx - rx}
            y={cy - ry}
            width={rx * 2}
            height={ry * 2}
            fill="url(#beam-mesh-fade)"
          />
        </mask>
      </defs>
      <path className="grid" d={d} mask="url(#beam-mesh-mask)" />
    </>
  );
}

/**
 * A link between two machines: a flat band on the ground with a lane
 * each way, toned for how it connects.
 */
export function Link({
  path,
  tone,
  className,
}: {
  path: readonly Vec2[];
  tone: 'sage' | 'sand';
  className?: string;
}) {
  return (
    <g className={className}>
      {ribbon(path, LANE * 2 + 0.3).map((points) => (
        <polygon key={points} points={points} className={`band-${tone}`} />
      ))}
      {([-1, 1] as const).map((side) => (
        <polyline
          key={side}
          points={onScreen(lane(path, side)).join(' ')}
          className={`lane-${tone} o`}
        />
      ))}
    </g>
  );
}

/** A marker flat on the ground at a path's end, for tokens on the move. */
export function Token({
  at,
  className,
}: {
  /** The ground path it travels; it is drawn at the end. */
  at: readonly Vec2[];
  className: string;
}) {
  const [x, y] = at[at.length - 1]!;
  const r = 0.26;
  return (
    <polygon
      className={`${className} gone`}
      points={toPoints([
        [x - r, y - r, 0.03],
        [x + r, y - r, 0.03],
        [x + r, y + r, 0.03],
        [x - r, y + r, 0.03],
      ])}
    />
  );
}

/**
 * Tailscale's mark, from the credit row's logo (public/media/
 * tailscale-logo-*.svg): a 3×3 grid of dots, 144 units square, four
 * solid and the rest at 40%. Drawn inline so it follows the theme and
 * the scene's projection.
 */
const TAILSCALE_DOTS = [
  [18, 18, true],
  [72, 18, true],
  [126, 18, true],
  [18, 72, false],
  [72, 72, false],
  [126, 72, false],
  [18, 126, true],
  [72, 126, false],
  [126, 126, true],
] as const;

/** A circle of radius `r` on a horizontal plane, as the ellipse it projects to. */
function Disc({
  at,
  r,
  className,
}: {
  at: Vec3;
  r: number;
  className: string;
}) {
  const [x, y] = project(at);
  const d = r / Math.SQRT2;
  return (
    <ellipse
      className={className}
      cx={x}
      cy={y}
      rx={project([d, -d, 0])[0]}
      ry={project([d, d, 0])[1]}
    />
  );
}

/**
 * The relay, Tailscale's DERP: a low node in the machines' family, its
 * mark laid on the top face in the same projection as the ground. The
 * mark's rows run along ground y, so it reads front-on from the corner.
 * A ring on the ground pulses while it hands traffic over.
 */
export function TailscaleRelay({ cx, cy }: { cx: number; cy: number }) {
  const side = 2.4;
  const body: Box = {
    x: cx - side / 2,
    y: cy - side / 2,
    z: 0,
    w: side,
    d: side,
    h: 0.42,
  };
  const mark = 1.8;
  const k = mark / 144;
  const top = body.z + body.h;
  return (
    <g>
      <Disc at={[cx, cy, 0]} r={2.1} className="relay-on gone" />
      {boxFaces(body).map((face) => (
        <polygon
          key={face.tone}
          points={face.points}
          className={`n10-iso-face n10-iso-face--${face.tone} relay--${face.tone}`}
        />
      ))}
      {TAILSCALE_DOTS.map(([dx, dy, dim]) => (
        <Disc
          key={`${dx}-${dy}`}
          at={[cx - mark / 2 + dx * k, cy - mark / 2 + dy * k, top]}
          r={18 * k}
          className={dim ? 'ts-dot ts-dot--dim' : 'ts-dot'}
        />
      ))}
    </g>
  );
}
