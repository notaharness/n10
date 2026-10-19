/**
 * Keyframes for one illustration, written in milliseconds on a single
 * shared clock rather than as hand-computed percentages.
 *
 * Every track runs for the piece's whole duration, so beats line up by
 * construction. Each track is a list of `[ms, declarations]` stops; the
 * first stop is held from 0 and the last to the end, and the shared
 * easing applies to every segment between stops (a hold between equal
 * stops is unaffected). The SVG's own attributes and classes are the
 * final composition, so the last stop of every track must equal the
 * element's resting style — that is what reduced motion, no JavaScript
 * and the held end of the animation all show.
 */
/** How long a loop holds its final frame before it fades and restarts. */
export const HOLD = 2000;

export type Stop = readonly [ms: number, css: string];
export type Tracks = Record<string, readonly Stop[]>;

const pct = (ms: number, total: number) =>
  `${+((ms / total) * 100).toFixed(3)}%`;

export function timeline(name: string, total: number, tracks: Tracks): string {
  const rules = [
    // A clock the wrapper listens to, so it knows the sequence and its
    // hold finished even if it was paused offscreen along the way.
    `@keyframes ${name}-clock{from{opacity:1}to{opacity:1}}`,
    `[data-ill="${name}"][data-anim] .ill-clock{animation:${name}-clock ${
      total + HOLD
    }ms linear both}`,
  ];
  for (const [cls, stops] of Object.entries(tracks)) {
    const frames = stops.map(([ms, css]) => `${pct(ms, total)}{${css}}`);
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (first && first[0] > 0) frames.unshift(`0%{${first[1]}}`);
    if (last && last[0] < total) frames.push(`100%{${last[1]}}`);
    rules.push(
      `@keyframes ${name}-${cls}{${frames.join('')}}`,
      `[data-ill="${name}"][data-anim] .${cls}{animation:${name}-${cls} ${total}ms var(--ill-ease) both}`
    );
  }
  return rules.join('\n');
}

/** Hidden until `at`, fades in over `fade`ms, then stays. */
export function appear(at: number, fade = 250): Stop[] {
  return [
    [at, 'opacity:0'],
    [at + fade, 'opacity:1'],
  ];
}

/** Fades in while sliding from (dx, dy) to its resting position. */
export function arrive(at: number, dx: number, dy: number, move = 600): Stop[] {
  return [
    [at, `opacity:0;transform:translate(${dx}px,${dy}px)`],
    [at + 250, `opacity:1;transform:translate(${dx * 0.4}px,${dy * 0.4}px)`],
    [at + move, 'opacity:1;transform:translate(0,0)'],
  ];
}

/** Shown from `from` to `to` only; its resting style is hidden. */
export function transient(from: number, to: number, fade = 250): Stop[] {
  return [
    [from, 'opacity:0'],
    [from + fade, 'opacity:1'],
    [to, 'opacity:1'],
    [to + fade, 'opacity:0'],
  ];
}

/** Visible until `at`, then fades out for good. */
export function leave(at: number, fade = 250): Stop[] {
  return [
    [at, 'opacity:1'],
    [at + fade, 'opacity:0'],
  ];
}

type Point = readonly [number, number];

/**
 * A token that travels an orthogonal path and fades out on arrival. Draw
 * it centred on the path's last point; the stops translate it back along
 * the path. Corners keep their speed: only the departure eases in and
 * the arrival eases out.
 */
export function travel(
  points: readonly Point[],
  at: number,
  move = 700
): Stop[] {
  const end = points[points.length - 1]!;
  const lengths = points
    .slice(1)
    .map(
      (p, i) => Math.abs(p[0] - points[i]![0]) + Math.abs(p[1] - points[i]![1])
    );
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const at0 = at + 150;
  const off = (p: Point) =>
    `transform:translate(${p[0] - end[0]}px,${p[1] - end[1]}px)`;
  const stops: Stop[] = [
    [at, `opacity:0;${off(points[0]!)}`],
    [
      at0,
      `opacity:1;${off(points[0]!)}${
        points.length > 2
          ? ';animation-timing-function:cubic-bezier(.4,0,1,1)'
          : ''
      }`,
    ],
  ];
  let run = 0;
  points.slice(1).forEach((p, i) => {
    run += lengths[i]!;
    const last = i === points.length - 2;
    const timing = last
      ? ''
      : `;animation-timing-function:${
          i === points.length - 3 ? 'cubic-bezier(0,0,.2,1)' : 'linear'
        }`;
    stops.push([at0 + (move * run) / total, `opacity:1;${off(p)}${timing}`]);
  });
  stops.push([at0 + move + 200, 'opacity:0;transform:translate(0,0)']);
  return stops;
}
