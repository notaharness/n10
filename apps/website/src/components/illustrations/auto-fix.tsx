import { Logo } from '@/components/logo';
import { Illustration, type Box } from './illustration';
import { Bars, Connector } from './parts';
import { appear, timeline, transient } from './timeline';

/** The final composition's bounds, fitted into the shared frame. */
const BOX: Box = [32, 40, 584, 320];
/** Where the batch waits before the gate, relative to where it's delivered. */
const WAIT_DX = -164;
/** The session's output rows; the first three exist before Auto-fix acts. */
const ROWS = [0.7, 0.45, 0.8, 0.55, 0.85, 0.4, 0.65];

const css = timeline('auto-fix', 12000, {
  compressed: transient(600, 11000, 300),
  check: [
    [700, 'opacity:0;transform:translate(-162px,20px)'],
    [950, 'opacity:1;transform:translate(-162px,12px)'],
    [1500, 'opacity:1;transform:translate(-162px,12px)'],
    [2200, 'opacity:1;transform:translate(0,0)'],
  ],
  comment: [
    [2600, 'opacity:0;transform:translate(-270px,20px)'],
    [2850, 'opacity:1;transform:translate(-270px,12px)'],
    [3400, 'opacity:1;transform:translate(-270px,12px)'],
    [4100, 'opacity:1;transform:translate(0,0)'],
  ],
  tray: [
    [5600, 'stroke:var(--ill-rule)'],
    [5850, 'stroke:var(--ill-primary)'],
    [6300, 'stroke:var(--ill-primary)'],
    [6600, 'stroke:var(--ill-rule)'],
  ],
  batch: [
    [5900, `opacity:0;transform:translate(${WAIT_DX}px,-24px)`],
    [6150, `opacity:1;transform:translate(${WAIT_DX}px,-10px)`],
    [6500, `opacity:1;transform:translate(${WAIT_DX}px,0)`],
    [9800, `opacity:1;transform:translate(${WAIT_DX}px,0)`],
    [10500, 'opacity:1;transform:translate(0,0)'],
  ],
  ...Object.fromEntries(
    [3, 4, 5, 6].map((r, i) => [`row${r}`, appear(6600 + i * 400, 200)])
  ),
  boom: [
    [9100, 'transform:rotate(0deg)'],
    [9700, 'transform:rotate(-90deg)'],
  ],
  delivered: appear(10700),
});

export function AutoFixIllustration() {
  return (
    <Illustration
      name="auto-fix"
      box={BOX}
      css={css}
      title="Auto-fix batches feedback and waits for a quiet terminal"
      description="With n10 open and Auto-fix on, a failed check and a review comment from pull request 42 collect in one batch, which closes after ten quiet minutes or thirty at most. It waits until the agent's terminal has been quiet for thirty seconds, then enters the session as one delivered update."
    >
      <text className="t2 compressed gone" x="616" y="30" textAnchor="end">
        waits compressed
      </text>

      {/* Where the feedback comes from */}
      <rect className="sand o" x="32" y="72" width="144" height="160" rx="3" />
      <text className="t1" x="46" y="100">
        PR #42
      </text>
      <Bars x={46} y={116} width={116} widths={[0.85, 0.6]} />

      {/* n10, open, with Auto-fix on */}
      <rect
        className="surface o"
        x="192"
        y="40"
        width="256"
        height="320"
        rx="3"
      />
      <line
        className="o2"
        stroke="var(--ill-rule)"
        x1={192}
        x2={448}
        y1={76}
        y2={76}
      />
      <Logo aria-hidden x={206} y={51} height={14} width={24.5} />
      <rect className="solid-sage" x="244" y="53" width="10" height="10" />
      <text className="t1" x="262" y="64">
        Auto-fix on
      </text>

      <rect
        className="tray ground o"
        stroke="var(--ill-rule)"
        x="206"
        y="92"
        width="228"
        height="144"
        rx="2"
      />
      <Connector
        points={[
          [176, 178],
          [206, 178],
        ]}
      />
      <text className="t1" x="218" y="120">
        <tspan>10m quiet</tspan>
        <tspan x="218" dy="24">
          30m max
        </tspan>
      </text>
      <g className="check">
        <rect
          className="ground o2"
          stroke="var(--ill-sand-line)"
          x="216"
          y="158"
          width="100"
          height="64"
          rx="2"
        />
        <text className="t1 mono" x="228" y="184">
          test
        </text>
        <text className="t1" x="228" y="209">
          failed
        </text>
      </g>
      <g className="comment">
        <rect
          className="ground o2"
          stroke="var(--ill-sand-line)"
          x="324"
          y="158"
          width="100"
          height="64"
          rx="2"
        />
        <rect className="solid-sand" x="336" y="170" width="12" height="12" />
        <Bars x={336} y={192} width={76} widths={[0.95, 0.65]} />
      </g>

      <text className="t1" x="434" y="330" textAnchor="end">
        terminal quiet ≥30s
      </text>

      {/* The PR's agent session */}
      <rect className="sage o" x="456" y="72" width="160" height="288" rx="3" />
      <text className="t1 mono" x="470" y="100">
        fix/cache
      </text>
      <rect
        className="ground o2"
        x="468"
        y="112"
        width="136"
        height="228"
        rx="2"
      />
      {ROWS.map((w, r) => (
        <rect
          key={w}
          className={`bar${r > 2 ? ` row${r}` : ''}`}
          x="480"
          y={126 + r * 18}
          width={100 * w}
          height="5"
          rx="2.5"
        />
      ))}
      <Connector
        points={[
          [320, 236],
          [320, 284],
          [468, 284],
        ]}
      />
      <rect className="solid-mix" x="402" y="258" width="12" height="8" />
      <rect
        className="boom"
        x="406.5"
        y="266"
        width="3"
        height="36"
        style={{
          fill: 'var(--ill-muted)',
          transformOrigin: '50% 0',
          transform: 'rotate(-90deg)',
        }}
      />
      <g className="batch">
        <rect
          className="sage-strong o focus"
          x="500"
          y="270"
          width="64"
          height="28"
          rx="2"
        />
        <rect className="solid-sand" x="510" y="280" width="20" height="8" />
        <rect
          x="534"
          y="280"
          width="20"
          height="8"
          style={{ fill: 'var(--ill-sand-line)' }}
        />
      </g>
      <text className="t1 delivered" x="536" y="324" textAnchor="middle">
        Delivered
      </text>
    </Illustration>
  );
}
