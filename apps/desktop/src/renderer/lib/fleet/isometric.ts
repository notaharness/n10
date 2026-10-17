/**
 * The 30° isometric projection of the website's beam mesh
 * (apps/website/src/components/beam/mesh/geometry.ts), trimmed to what
 * the Fleet first run draws. x runs down-right on screen, y down-left,
 * z straight up; a box shows its top, its +y face ("left") and its +x
 * face ("right").
 */
const UNIT = 24;
const COS = Math.cos(Math.PI / 6);

export type Vec3 = readonly [x: number, y: number, z: number];
export type Tone = 'top' | 'left' | 'right';

export interface Box {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function project([x, y, z]: Vec3): readonly [number, number] {
  return [round((x - y) * COS * UNIT), round((x + y) * 0.5 * UNIT - z * UNIT)];
}

export function toPoints(corners: readonly Vec3[]): string {
  return corners.map((c) => project(c).join(',')).join(' ');
}

export function boxFaces({ x, y, z, w, d, h }: Box): {
  tone: Tone;
  points: string;
}[] {
  const [x1, y1, z1] = [x + w, y + d, z + h];
  return [
    {
      tone: 'top',
      points: toPoints([
        [x, y, z1],
        [x1, y, z1],
        [x1, y1, z1],
        [x, y1, z1],
      ]),
    },
    {
      tone: 'left',
      points: toPoints([
        [x, y1, z1],
        [x1, y1, z1],
        [x1, y1, z],
        [x, y1, z],
      ]),
    },
    {
      tone: 'right',
      points: toPoints([
        [x1, y, z1],
        [x1, y1, z1],
        [x1, y1, z],
        [x1, y, z],
      ]),
    },
  ];
}

/** A rectangle on a box's left (+y) face; u runs along x, v up, both 0–1. */
export function onLeft(b: Box, u0: number, v0: number, u1: number, v1: number) {
  const at = (u: number, v: number): Vec3 => [
    b.x + u * b.w,
    b.y + b.d,
    b.z + v * b.h,
  ];
  return toPoints([at(u0, v1), at(u1, v1), at(u1, v0), at(u0, v0)]);
}

/** A rectangle on a box's right (+x) face; u runs along y, v up, both 0–1. */
export function onRight(
  b: Box,
  u0: number,
  v0: number,
  u1: number,
  v1: number
) {
  const at = (u: number, v: number): Vec3 => [
    b.x + b.w,
    b.y + u * b.d,
    b.z + v * b.h,
  ];
  return toPoints([at(u0, v1), at(u1, v1), at(u1, v0), at(u0, v0)]);
}

/** A point inside a quad (corners in order), by bilinear u, v. */
export function inQuad(
  [a, b, c, d]: readonly [Vec3, Vec3, Vec3, Vec3],
  u: number,
  v: number
): Vec3 {
  const mix = (p: Vec3, q: Vec3, t: number): Vec3 => [
    p[0] + (q[0] - p[0]) * t,
    p[1] + (q[1] - p[1]) * t,
    p[2] + (q[2] - p[2]) * t,
  ];
  return mix(mix(a, b, u), mix(d, c, u), v);
}
