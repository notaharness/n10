import { Illustration, type Box } from './illustration';
import { Connector, N10Window } from './parts';
import { appear, arrive, timeline, travel } from './timeline';

/** The final composition's bounds, fitted into the shared frame. */
const BOX: Box = [32, 35, 584, 309];

type Point = readonly [number, number];
const P1_OUT: Point[] = [
  [192, 132],
  [224, 132],
  [224, 80],
  [256, 80],
];
const P1_IN: Point[] = [
  [256, 120],
  [240, 120],
  [240, 190],
  [178, 190],
];
const P2_OUT: Point[] = [
  [192, 248],
  [224, 248],
  [224, 320],
  [256, 320],
];
const P2_IN: Point[] = [
  [256, 280],
  [240, 280],
  [240, 226],
  [178, 226],
];

const css = timeline('orchestra', 12000, {
  out1: appear(900),
  tok1: travel(P1_OUT, 900, 600),
  p1: arrive(1500, -12, 0),
  out2: appear(1900),
  tok2: travel(P2_OUT, 1900, 600),
  p2: arrive(2500, -12, 0),
  in1: appear(4000),
  tok3: travel(P1_IN, 4000, 650),
  progress: appear(4750),
  in2: appear(5600),
  tok4: travel(P2_IN, 5600, 650),
  question: appear(6350),
  row1: appear(7400, 300),
  row2: appear(7900, 300),
});

function Player({
  y,
  branch,
  className,
}: {
  y: number;
  branch: string;
  className: string;
}) {
  return (
    <g className={className}>
      <rect className="sage o" x="256" y={y} width="160" height="96" rx="3" />
      <text className="t2" x="256" y={y - 7}>
        player
      </text>
      <text className="t1 mono" x="270" y={y + 32}>
        {branch}
      </text>
      <rect
        className="ground o2"
        x="270"
        y={y + 48}
        width="132"
        height="32"
        rx="2"
      />
      <rect className="solid-sand" x="280" y={y + 59} width="10" height="10" />
      <text className="t1" x="298" y={y + 70}>
        task
      </text>
    </g>
  );
}

function Report({
  y,
  label,
  className,
}: {
  y: number;
  label: string;
  className: string;
}) {
  return (
    <g className={className}>
      <rect className="ground o2" x="46" y={y} width="132" height="28" rx="2" />
      <rect className="solid-sage" x="56" y={y + 9} width="10" height="10" />
      <text className="t1" x="74" y={y + 20}>
        {label}
      </text>
    </g>
  );
}

function Row({
  y,
  branch,
  className,
}: {
  y: number;
  branch: string;
  className?: string;
}) {
  return (
    <g className={className}>
      <rect className="solid-sage" x="452" y={y + 9} width="8" height="10" />
      <text className="t1 mono" x="466" y={y + 20}>
        {branch}
      </text>
    </g>
  );
}

export function OrchestraIllustration() {
  return (
    <Illustration
      name="orchestra"
      box={BOX}
      css={css}
      title="An optional coordinator delegates to player sessions"
      description="A coordinator session sends tasks to two players, each in its own tmux session and worktree. One reports progress and the other asks a question. n10 lists both worktrees beside one you started yourself, which has no link to the coordinator."
    >
      {/* The coordinator: a session of its own, outside n10 */}
      <rect
        className="sage-strong o"
        x="32"
        y="112"
        width="160"
        height="152"
        rx="3"
      />
      <text className="t1" x="46" y="142">
        coordinator
      </text>
      <text className="t2 mono" x="46" y="162">
        tmux
      </text>
      <Report y={176} label="progress" className="progress" />
      <Report y={212} label="question" className="question" />

      {/* Tasks out, reports back */}
      <Connector className="out1" points={P1_OUT} />
      <Connector className="out2" points={P2_OUT} />
      <Connector className="in1" points={P1_IN} />
      <Connector className="in2" points={P2_IN} />
      <Player y={56} branch="fix/cache" className="p1" />
      <Player y={248} branch="ui/tabs" className="p2" />
      {[
        { cls: 'tok1', p: P1_OUT, tone: 'solid-sand' },
        { cls: 'tok2', p: P2_OUT, tone: 'solid-sand' },
        { cls: 'tok3', p: P1_IN, tone: 'solid-sage' },
        { cls: 'tok4', p: P2_IN, tone: 'solid-sage' },
      ].map(({ cls, p, tone }) => {
        const [x, y] = p[p.length - 1]!;
        return (
          <rect
            key={cls}
            className={`${cls} ${tone} gone`}
            x={x - 5}
            y={y - 5}
            width="10"
            height="10"
          />
        );
      })}

      {/* n10 lists worktrees, whoever started them */}
      <N10Window
        x={440}
        y={56}
        width={176}
        height={288}
        strip={32}
        title="n10"
      />
      <g className="row1">
        <path
          className="o2 wire-dash"
          stroke="var(--ill-muted)"
          d="M416 110H446"
        />
        <Row y={96} branch="fix/cache" />
      </g>
      <Row y={188} branch="docs/faq" />
      <text className="t2" x="466" y="236">
        started by you
      </text>
      <text className="t1 muted phone" x="466" y="238">
        <tspan>started</tspan>
        <tspan x="466" dy="24">
          by you
        </tspan>
      </text>
      <g className="row2">
        <path
          className="o2 wire-dash"
          stroke="var(--ill-muted)"
          d="M416 298H446"
        />
        <Row y={284} branch="ui/tabs" />
      </g>
    </Illustration>
  );
}
