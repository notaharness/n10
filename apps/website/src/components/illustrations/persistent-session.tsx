import { Illustration, type Box } from './illustration';
import { Bars, N10Window } from './parts';
import { appear, timeline, transient } from './timeline';

/** The final composition's bounds, fitted into the shared frame. */
const BOX: Box = [32, 56, 576, 287];

/** A connection between an interface and the session, with a socket at each end. */
function Link({
  x1,
  x2,
  y,
  className,
}: {
  x1: number;
  x2: number;
  y: number;
  className: string;
}) {
  return (
    <g className={className}>
      <line
        className="o"
        stroke="var(--ill-sage-line)"
        x1={x1}
        x2={x2}
        y1={y}
        y2={y}
      />
      <rect className="solid-sage" x={x1 - 4} y={y - 4} width="8" height="8" />
      <rect className="solid-sage" x={x2 - 4} y={y - 4} width="8" height="8" />
    </g>
  );
}

const css = timeline('persist', 12000, {
  app: [
    [1500, 'opacity:1'],
    [1800, 'opacity:0'],
    [6800, 'opacity:0'],
    [7100, 'opacity:1'],
  ],
  ghost: transient(1700, 6800),
  'link-app': [
    [1300, 'opacity:1'],
    [1550, 'opacity:0'],
    [7300, 'opacity:0'],
    [7600, 'opacity:1'],
  ],
  work1: appear(2600, 300),
  work2: appear(3300, 300),
  work3: appear(4000, 300),
  prompt: transient(0, 4500, 200),
  attach: appear(4600),
  'term-out': appear(5000, 300),
  'link-term': appear(5300, 300),
  note: appear(8300, 300),
});

/** Rows of output in the attached terminal. */
const TERM_ROWS = [0.7, 0.85, 0.5, 0.75, 0.6];

export function PersistentSessionIllustration() {
  return (
    <Illustration
      name="persist"
      box={BOX}
      css={css}
      title="The tmux session outlives the n10 window"
      description="An n10 window is attached to the tmux session for fix/cache. Quitting n10 drops only the connection; the agent keeps working in the session. A terminal attaches to the same session with tmux attach, and reopening n10 reconnects to it."
    >
      {/* The session: one identity throughout */}
      <rect
        className="sage-strong o"
        x="208"
        y="80"
        width="176"
        height="200"
        rx="3"
      />
      <text className="t1 mono muted" x="224" y="116">
        tmux $3
      </text>
      <text className="t1 mono" x="224" y="146">
        fix/cache
      </text>
      <rect className="solid-sage" x="224" y="168" width="8" height="10" />
      <rect
        className="bar-strong"
        x="240"
        y="170"
        width="96"
        height="6"
        rx="3"
      />
      <rect
        className="work1 bar-strong"
        x="224"
        y="192"
        width="120"
        height="6"
        rx="3"
      />
      <rect
        className="work2 bar-strong"
        x="224"
        y="212"
        width="76"
        height="6"
        rx="3"
      />
      <rect
        className="work3 bar-strong"
        x="224"
        y="232"
        width="104"
        height="6"
        rx="3"
      />
      <text className="note t1 muted" x="296" y="336" textAnchor="middle">
        survives app close
      </text>

      {/* n10: quits, then reconnects to the same session */}
      <g className="ghost gone">
        <rect
          className="o2 wire-dash"
          fill="none"
          stroke="var(--ill-rule)"
          x="32"
          y="56"
          width="136"
          height="248"
          rx="3"
        />
        <text className="t1 muted" x="100" y="186" textAnchor="middle">
          Quit n10
        </text>
      </g>
      <N10Window
        className="app"
        x={32}
        y={56}
        width={136}
        height={248}
        strip={32}
      >
        <text className="t1" x="48" y="126">
          n10
        </text>
        <Bars
          x={48}
          y={146}
          width={104}
          widths={[0.8, 0.55, 0.9, 0.4, 0.7]}
          pitch={18}
        />
      </N10Window>
      <Link className="link-app" x1={168} x2={208} y={180} />

      {/* A terminal, then attached to that same session */}
      <rect
        className="ground o"
        x="416"
        y="56"
        width="192"
        height="248"
        rx="3"
      />
      <line
        className="o2"
        stroke="var(--ill-rule)"
        x1={416}
        x2={608}
        y1={110}
        y2={110}
      />
      <rect
        className="prompt gone"
        x="428"
        y="77"
        width="10"
        height="18"
        style={{ fill: 'var(--ill-muted)' }}
      />
      <text className="attach t1 mono" x="428" y="92">
        tmux attach
      </text>
      <g className="term-out">
        <Bars x={428} y={130} width={164} widths={TERM_ROWS} pitch={18} />
      </g>
      <Link className="link-term" x1={384} x2={416} y={180} />
    </Illustration>
  );
}
