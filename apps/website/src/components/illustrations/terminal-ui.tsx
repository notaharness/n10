import { Illustration, type Box } from './illustration';
import { Bars, N10Window } from './parts';

/** The final composition's bounds, fitted into the shared frame. */
const BOX: Box = [40, 48, 560, 304];
/** Where each interface's lower edge overlaps the shared plane: half a module. */
const BASE_Y = 276;
const OVERLAP = 12;
const TOP = 48;
/** The TUI's sidebar rows: highlight marks the selected worktree. */
const TUI_ROWS = [40, 32, 44, 28, 36, 24];

export function TerminalUiIllustration() {
  return (
    <Illustration
      name="tui"
      box={BOX}
      title="n10 and the TUI share one base"
      description="n10 and the TUI, n10 --tui, both rest on the same worktrees and tmux sessions."
    >
      {/* Shared base */}
      <rect
        className="sage o"
        x="40"
        y={BASE_Y}
        width="560"
        height="76"
        rx="3"
      />
      <text className="t1 mono" x="320" y={BASE_Y + 50} textAnchor="middle">
        worktrees / tmux sessions
      </text>

      {/* n10: a window with a sidebar and a pane */}
      <N10Window
        x={64}
        y={TOP}
        width={232}
        height={BASE_Y + OVERLAP - TOP}
        strip={30}
        title="n10"
      >
        <line
          className="o2"
          stroke="var(--ill-rule)"
          x1={128}
          x2={128}
          y1={TOP + 30}
          y2={BASE_Y}
        />
        <Bars
          x={78}
          y={TOP + 48}
          width={36}
          widths={[1, 0.8, 1, 0.6, 0.9, 0.7]}
          pitch={18}
          h={6}
        />
        <rect
          className="ground o2"
          x="142"
          y={TOP + 46}
          width="140"
          height="78"
          rx="2"
        />
        <Bars
          x={154}
          y={TOP + 60}
          width={110}
          widths={[0.9, 0.6, 0.75, 0.5]}
          pitch={14}
        />
        <Bars
          className="bar-strong"
          x={142}
          y={TOP + 144}
          width={140}
          widths={[0.85, 0.5, 0.7]}
          pitch={16}
          h={6}
        />
      </N10Window>
      <rect
        className="solid-mix"
        x="64.75"
        y={BASE_Y + 0.75}
        width="230.5"
        height={OVERLAP - 0.75}
      />

      {/* The terminal UI: the same parts in characters */}
      <rect
        className="ground o"
        x="344"
        y={TOP}
        width="232"
        height={BASE_Y + OVERLAP - TOP}
        rx="3"
      />
      <text className="t1 mono" x="358" y={TOP + 22}>
        n10 --tui
      </text>
      <line
        className="o2"
        stroke="var(--ill-rule)"
        x1={344}
        x2={576}
        y1={TOP + 30}
        y2={TOP + 30}
      />
      <rect
        className="o2"
        fill="none"
        stroke="var(--ill-muted)"
        x="356"
        y={TOP + 42}
        width="72"
        height="174"
      />
      <rect
        className="o2"
        fill="none"
        stroke="var(--ill-muted)"
        x="436"
        y={TOP + 42}
        width="128"
        height="174"
      />
      {TUI_ROWS.map((w, i) => (
        <g key={w}>
          <rect
            className={i === 1 ? 'solid-sage' : 'bar-strong'}
            x="364"
            y={TOP + 56 + i * 18}
            width="6"
            height="6"
          />
          <rect
            className="bar"
            x="376"
            y={TOP + 56.5 + i * 18}
            width={w}
            height="5"
            rx="2.5"
          />
        </g>
      ))}
      <Bars
        x={446}
        y={TOP + 58}
        width={104}
        widths={[0.85, 0.6, 0.95, 0.45, 0.7, 0.8, 0.55, 0.9]}
        pitch={16}
      />
      <rect
        className="solid-mix"
        x="344.75"
        y={BASE_Y + 0.75}
        width="230.5"
        height={OVERLAP - 0.75}
      />
    </Illustration>
  );
}
