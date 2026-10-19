import { Illustration, type Box } from './illustration';
import { Bars, Connector, Pointer, Tick } from './parts';
import { appear, arrive, timeline, transient } from './timeline';

/** The final composition's bounds, fitted into the shared frame. */
const BOX: Box = [32, 30, 576, 322];
/** Review comment cards on the PR: top edge of each, and whether it's picked. */
const COMMENTS = [
  { y: 112, picked: true, cls: 'c1' },
  { y: 184, picked: false, cls: 'c2' },
  { y: 256, picked: true, cls: 'c3' },
] as const;

const checked = (at: number) =>
  [
    [at, 'fill:var(--ill-ground)'],
    [at + 200, 'fill:var(--ill-primary)'],
  ] as const;

const css = timeline('plan', 10000, {
  'check-c1': checked(700),
  'check-c3': checked(1300),
  'tick-c1': appear(750, 150),
  'tick-c3': appear(1350, 150),
  sheet: arrive(2000, 0, 10),
  chip1: [
    [2500, 'opacity:0;transform:translate(-180px,-10px)'],
    [2650, 'opacity:1;transform:translate(-180px,-10px)'],
    [3250, 'opacity:1;transform:translate(0,0)'],
  ],
  chip2: [
    [2800, 'opacity:0;transform:translate(-180px,90px)'],
    [2950, 'opacity:1;transform:translate(-180px,90px)'],
    [3550, 'opacity:1;transform:translate(0,0)'],
  ],
  link1: appear(3300),
  link3: appear(3600),
  c2: [
    [3600, 'opacity:1'],
    [3900, 'opacity:0.45'],
  ],
  note: appear(4400),
  'note-words': [
    [4500, 'transform:scaleX(0)'],
    [5100, 'transform:scaleX(1)'],
  ],
  prompt: appear(5400, 300),
  cursor: [
    [6100, 'opacity:0;transform:translate(70px,50px)'],
    [6350, 'opacity:1;transform:translate(70px,50px)'],
    [6900, 'opacity:1;transform:translate(0,0)'],
    [8300, 'opacity:1;transform:translate(0,0)'],
    [8550, 'opacity:0;transform:translate(0,0)'],
  ],
  ring: transient(7050, 7300, 150),
  send: appear(7400),
  task: arrive(7500, -14, 0),
});

export function FeedbackPlanIllustration() {
  return (
    <Illustration
      name="plan"
      box={BOX}
      css={css}
      title="Review comments become one task for the branch's agent"
      description="Two of three review comments on the fix/cache pull request are selected and collected into a plan with your instructions. Sending it delivers one task to the agent session already running for fix/cache. The third comment stays behind."
    >
      {/* One branch runs through every step */}
      <text className="t1 mono" x="32" y="52">
        fix/cache
      </text>
      <line
        className="o"
        stroke="var(--ill-sage-line)"
        x1="176"
        x2="608"
        y1="45"
        y2="45"
      />

      {/* The pull request's incoming comments */}
      <rect className="sand o" x="32" y="72" width="152" height="280" rx="3" />
      <text className="t1" x="46" y="100">
        PR #42
      </text>
      {COMMENTS.map(({ y, picked, cls }) => (
        <g
          key={y}
          className={picked ? undefined : cls}
          opacity={picked ? undefined : 0.45}
        >
          <rect
            className="ground o2"
            x="46"
            y={y}
            width="124"
            height="56"
            rx="2"
          />
          <rect
            className={`o2 ${picked ? `check-${cls}` : ''}`}
            x="56"
            y={y + 10}
            width="14"
            height="14"
            rx="2"
            style={{
              fill: picked ? 'var(--ill-primary)' : 'var(--ill-ground)',
              stroke: picked ? 'var(--ill-primary)' : 'var(--ill-muted)',
            }}
          />
          {picked && (
            <Tick
              x={63}
              y={y + 17}
              s={0.75}
              className={`tick-on tick-${cls}`}
            />
          )}
          <Bars
            x={80}
            y={y + 12}
            width={80}
            widths={[0.95, 0.7, 0.85]}
            pitch={13}
          />
        </g>
      ))}

      {/* The plan: picked comments plus your note, previewed as one prompt */}
      <g className="sheet">
        <rect
          className="ground o"
          x="212"
          y="72"
          width="168"
          height="280"
          rx="3"
        />
        <text className="t1" x="226" y="100">
          Plan
        </text>
      </g>
      <Connector
        className="link1"
        points={[
          [170, 140],
          [226, 140],
        ]}
      />
      <Connector
        className="link3"
        points={[
          [170, 284],
          [198, 284],
          [198, 184],
          [226, 184],
        ]}
      />
      <g className="chip1">
        <rect
          className="sand o2"
          x="226"
          y="122"
          width="140"
          height="36"
          rx="2"
        />
        <Bars x={238} y={132} width={110} widths={[0.9, 0.6]} />
      </g>
      <g className="chip2">
        <rect
          className="sand o2"
          x="226"
          y="166"
          width="140"
          height="36"
          rx="2"
        />
        <Bars x={238} y={176} width={110} widths={[0.8, 0.7]} />
      </g>
      <g className="note">
        <rect
          className="o focus wire-dash"
          fill="none"
          x="226"
          y="210"
          width="140"
          height="36"
          rx="2"
        />
        <g className="note-words" style={{ transformOrigin: 'left' }}>
          <rect
            x="238"
            y="220"
            width="100"
            height="5"
            rx="2.5"
            style={{ fill: 'var(--ill-primary)', opacity: 0.6 }}
          />
          <rect
            x="238"
            y="232"
            width="64"
            height="5"
            rx="2.5"
            style={{ fill: 'var(--ill-primary)', opacity: 0.6 }}
          />
        </g>
      </g>
      <rect
        className="prompt o2 focus"
        fill="none"
        x="219"
        y="115"
        width="154"
        height="138"
        rx="3"
      />
      <rect
        className="btn sheet"
        x="226"
        y="288"
        width="140"
        height="40"
        rx="3"
      />
      <text className="t1 on-primary sheet" x="296" y="315" textAnchor="middle">
        Send
      </text>
      <rect
        className="ring gone o focus"
        fill="none"
        x="222"
        y="284"
        width="148"
        height="48"
        rx="5"
      />

      {/* The branch's existing agent session */}
      <rect className="sage o" x="408" y="72" width="200" height="280" rx="3" />
      <text className="t1" x="422" y="100">
        agent session
      </text>
      <rect
        className="ground o2"
        x="422"
        y="112"
        width="172"
        height="226"
        rx="2"
      />
      <Bars
        x={434}
        y={128}
        width={148}
        widths={[0.7, 0.45, 0.85, 0.6, 0.3]}
        pitch={16}
      />
      <Connector
        className="send"
        primary
        points={[
          [366, 308],
          [390, 308],
          [390, 278],
          [434, 278],
        ]}
      />
      <g className="task">
        <rect
          className="sage-strong o focus"
          x="434"
          y="250"
          width="148"
          height="56"
          rx="2"
        />
        <text className="t1" x="448" y="285">
          1 task
        </text>
      </g>
      <Pointer x={306} y={310} className="cursor gone" />
    </Illustration>
  );
}
