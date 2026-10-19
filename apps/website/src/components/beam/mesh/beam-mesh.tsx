import {
  Illustration,
  type Box as Frame,
} from '@/components/illustrations/illustration';
import { appear, timeline, travel } from '@/components/illustrations/timeline';
import { inQuad, toPoints, type Vec2 } from './geometry';
import { Laptop, laptopLid, Mini, Rack, Tower } from './machines';
import {
  Ground,
  lane,
  Link,
  onScreen,
  TailscaleRelay,
  Token,
} from './mesh-parts';
import './beam-mesh.css';

/**
 * Your laptop reaching the rest of your fleet over WireGuard, drawn in a
 * 30° isometric projection (see geometry.ts) in the illustrations' shared
 * language. Two machines answer directly; the workstation is reached
 * through a Tailscale relay, and a session's output comes back the same
 * way. The section's copy explains it, so the drawing carries no labels.
 * Machines are listed back to front, the order they have to be painted.
 */
const machines = [
  { id: 'rack', cx: 3, cy: 3, Shape: Rack },
  { id: 'tower', cx: 10, cy: 3, Shape: Tower },
  { id: 'laptop', cx: 3, cy: 10, Shape: Laptop },
  { id: 'mini', cx: 10, cy: 10, Shape: Mini },
] as const;

/** The final composition's bounds on screen. */
const BOX: Frame = [-204, -18, 394, 284];
/** The frame's height in board units: the landing frame's own ratio. */
const HEIGHT = 372;

const TO_RACK: Vec2[] = [
  [3, 10],
  [3, 3],
];
const TO_MINI: Vec2[] = [
  [3, 10.5],
  [10, 10.5],
];
const TO_RELAY: Vec2[] = [
  [3, 9.5],
  [6.5, 9.5],
  [6.5, 6.5],
];
const RELAY_ON: Vec2[] = [
  [6.5, 6.5],
  [6.5, 4],
  [10, 4],
];
const BACK = lane([...TO_RELAY, ...RELAY_ON.slice(1)], 1).reverse();
const out = (path: Vec2[]) => lane(path, -1);

/** When each output packet leaves the workstation; each lands as a line. */
const OUTPUT = [4600, 5200, 5800];
const OUTPUT_MOVE = 1200;
const landed = (at: number) => at + 150 + OUTPUT_MOVE;

const css = timeline('mesh', 8200, {
  'link-rack': appear(400, 700),
  'tok-rack': travel(onScreen(out(TO_RACK)), 400, 700),
  'link-mini': appear(1100, 700),
  'tok-mini': travel(onScreen(out(TO_MINI)), 1100, 700),
  'link-relay': appear(2200, 600),
  'tok-relay': travel(onScreen(out(TO_RELAY)), 2200, 600),
  'relay-on': [
    [2900, 'opacity:0;transform:scale(0.7)'],
    [3100, 'opacity:1;transform:scale(0.85)'],
    [3600, 'opacity:1;transform:scale(1)'],
    [3850, 'opacity:0;transform:scale(1.08)'],
  ],
  'link-on': appear(3400, 500),
  'tok-on': travel(onScreen(out(RELAY_ON)), 3400, 500),
  ...Object.fromEntries(
    OUTPUT.flatMap((at, i) => [
      [`out${i}`, travel(onScreen(BACK), at, OUTPUT_MOVE)],
      [`line${i}`, appear(landed(at), 200)],
    ])
  ),
});

/** The laptop's screen: a shell on the workstation, then its output. */
const lid = laptopLid(3, 10);
const screenLine = (v: number, u1: number) =>
  toPoints([inQuad(lid, 0.12, v), inQuad(lid, u1, v)]);
const OUTPUT_LINES = [0.66, 0.5, 0.8];

export function BeamMesh({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <Illustration
        name="mesh"
        box={BOX}
        height={HEIGHT}
        pad={24}
        backdrop={<Ground centre={6.5} reach={16} radius={[300, 180]} />}
        css={css}
        title="Your laptop reaches your machines over WireGuard"
        description="A laptop connects directly to a build box and a home server. The workstation can't be reached directly, so the connection goes through a Tailscale relay. Output from a session on the workstation flows back through the relay to the laptop's screen."
      >
        <Link className="link-rack" path={TO_RACK} tone="sage" />
        <Link className="link-mini" path={TO_MINI} tone="sage" />
        <Link className="link-relay" path={TO_RELAY} tone="sand" />
        <Link className="link-on" path={RELAY_ON} tone="sand" />
        <Token at={out(TO_RACK)} className="tok-rack solid-sage" />
        <Token at={out(TO_MINI)} className="tok-mini solid-sage" />
        <Token at={out(TO_RELAY)} className="tok-relay solid-sand" />
        <Token at={out(RELAY_ON)} className="tok-on solid-sand" />
        {OUTPUT.map((at, i) => (
          <Token key={at} at={BACK} className={`out${i} solid-sage`} />
        ))}
        {machines.map(({ id, cx, cy, Shape }) => (
          <Shape key={id} cx={cx} cy={cy} />
        ))}
        <TailscaleRelay cx={6.5} cy={6.5} />
        <polyline className="screen-prompt" points={screenLine(0.24, 0.4)} />
        {OUTPUT_LINES.map((u1, i) => (
          <polyline
            key={u1}
            className={`line${i} screen-out`}
            points={screenLine(0.4 + i * 0.15, u1)}
          />
        ))}
      </Illustration>
    </figure>
  );
}
