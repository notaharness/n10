import { Illustration, type Box } from './illustration';
import { Bars, Tick } from './parts';
import { appear, arrive, timeline } from './timeline';

/** The final composition's bounds, fitted into the shared frame. */
const BOX: Box = [40, 52, 560, 296];
const BRANCH = 'M88 92V264Q88 280 104 280H232';

const css = timeline('worktree', 9000, {
  branch: [
    [700, 'stroke-dashoffset:1'],
    [1400, 'stroke-dashoffset:0'],
  ],
  'branch-label': appear(1200),
  checkout: arrive(1700, -14, 0),
  session: arrive(3000, 0, -12),
  'session-mix': appear(3500),
  ...Object.fromEntries(
    [0, 1, 2].map((i) => [`agent${i}`, appear(4100 + i * 300, 200)])
  ),
  pr: arrive(5600, 0, 12),
  'pr-mix': appear(6100),
});

export function WorktreeSessionIllustration() {
  return (
    <Illustration
      name="worktree"
      box={BOX}
      css={css}
      title="Each branch gets its own checkout and session"
      description="The main checkout stays on main. A fix/cache branch diverges into a separate worktree, where a tmux session runs its agent. The pull request status attaches to that same worktree, and main is untouched."
    >
      {/* main, and its checkout, never change */}
      <text className="t1 mono" x="40" y="76">
        main
      </text>
      <line
        className="o"
        stroke="var(--ill-sage-line)"
        x1="40"
        x2="232"
        y1="92"
        y2="92"
      />
      <rect
        className="ground o2"
        stroke="var(--ill-sage-line)"
        x="60"
        y="88"
        width="8"
        height="8"
      />
      <rect
        className="ground o2"
        stroke="var(--ill-sage-line)"
        x="156"
        y="88"
        width="8"
        height="8"
      />
      <rect
        className="sage-strong o"
        x="232"
        y="52"
        width="184"
        height="80"
        rx="3"
      />
      <text className="t1" x="248" y="86">
        checkout
      </text>
      <Bars
        className="bar-strong"
        x={248}
        y={102}
        width={140}
        widths={[0.7, 0.5]}
        pitch={11}
      />

      {/* fix/cache diverges into its own worktree */}
      <path
        className="branch o"
        d={BRANCH}
        fill="none"
        stroke="var(--ill-sage-line)"
        pathLength={1}
        strokeDasharray="1 1"
      />
      <g className="branch-label">
        <rect
          className="ground o2"
          stroke="var(--ill-sage-line)"
          x="156"
          y="276"
          width="8"
          height="8"
        />
        <text className="t1 mono" x="96" y="318">
          fix/cache
        </text>
      </g>
      <g className="checkout">
        <rect
          className="sage o"
          x="232"
          y="240"
          width="184"
          height="80"
          rx="3"
        />
        <text className="t1" x="248" y="274">
          worktree
        </text>
        <Bars
          className="bar-strong"
          x={248}
          y={290}
          width={120}
          widths={[0.55, 0.75]}
          pitch={11}
        />
      </g>

      {/* Its tmux session attaches to that directory, and the agent starts there */}
      <g className="session">
        <rect
          className="ground o"
          stroke="var(--ill-sage-line)"
          x="392"
          y="164"
          width="208"
          height="100"
          rx="3"
        />
        <text className="t1 mono" x="428" y="196">
          tmux
        </text>
      </g>
      <rect
        className="session-mix solid-mix"
        x="392.75"
        y="240.75"
        width="22.5"
        height="22.5"
      />
      <rect
        className="agent0 solid-sage"
        x="428"
        y="212"
        width="8"
        height="10"
      />
      <rect
        className="agent1 bar-strong"
        x="444"
        y="214"
        width="96"
        height="6"
        rx="3"
      />
      <rect
        className="agent2 bar"
        x="428"
        y="232"
        width="124"
        height="6"
        rx="3"
      />

      {/* The PR's status belongs to the same worktree */}
      <g className="pr">
        <rect
          className="sand-strong o"
          x="248"
          y="308"
          width="136"
          height="40"
          rx="3"
        />
        <Tick x={268} y={331} />
        <text className="t1" x="282" y="338">
          PR #42
        </text>
      </g>
      <rect
        className="pr-mix solid-mix"
        x="248.75"
        y="308.75"
        width="134.5"
        height="11.25"
      />
    </Illustration>
  );
}
