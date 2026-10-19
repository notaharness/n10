import { Bars, Tick } from './parts';

/*
 * The PR sheet and the diff of the review workspace illustration, split
 * from review-workspace.tsx to keep it within the line budget. Class
 * names are the timeline tracks declared there.
 */
/** Column split inside the window: PR sheet left, review workspace right. */
export const SPLIT = 300;
/** Diff rows: top of the first row and the row pitch. */
const ROW0 = 100;
const PITCH = 22;
export const rowTop = (i: number) => ROW0 + i * PITCH;

/** Indent and length of each diff row's code; rows 3 and 4 are the change. */
const DIFF: readonly (readonly [number, number])[] = [
  [0, 0.52],
  [18, 0.66],
  [18, 0.42],
  [18, 0.58],
  [18, 0.74],
  [18, 0.36],
  [0, 0.14],
];

export function ReviewSheetAndDiff() {
  return (
    <>
      {/* PR sheet */}
      <g className="sheet">
        <text className="t1" x="48" y="94">
          PR #42
        </text>
        <text className="t2 mono" x="48" y="117">
          fix/cache → main
        </text>
        <Bars x={48} y={134} width={228} widths={[0.92, 0.78, 0.6]} />
        <text className="t2" x="48" y="210">
          Files
        </text>
        {[1, 2].map((i) => (
          <rect
            key={i}
            className="surface o2"
            x="40"
            y={220 + i * 30}
            width="236"
            height="24"
            rx="2"
          />
        ))}
        <text className="t2 mono" x="54" y="267">
          store.ts
        </text>
        <text className="t2 mono" x="54" y="297">
          cache.test.ts
        </text>
        <Bars
          className="bar phone"
          x={54}
          y={258}
          width={160}
          widths={[0.5, 0.75]}
          pitch={30}
          h={6}
        />
      </g>
      <g className="checks">
        <Tick x={58} y={183} />
        <text className="t1" x="74" y="189">
          checks passed
        </text>
      </g>
      <rect
        className="pick sage o focus"
        x="40"
        y="220"
        width="236"
        height="24"
        rx="2"
      />
      <text className="t2 mono sheet" x="54" y="237">
        cache.ts
      </text>
      <rect
        className="bar phone sheet"
        x="54"
        y="229"
        width="64"
        height="6"
        rx="3"
      />

      {/* Diff of the selected file */}
      <g className="diff">
        <text className="t2 mono" x="324" y="83">
          src/cache.ts
        </text>
        <line
          className="o2"
          stroke="var(--ill-rule)"
          x1={SPLIT}
          x2={696}
          y1={92}
          y2={92}
        />
        {DIFF.map(([indent, len], i) => (
          <g key={rowTop(i)}>
            <rect
              className="bar"
              x="324"
              y={rowTop(i) + 8.5}
              width="12"
              height="5"
              rx="1"
            />
            <rect
              className="bar-strong"
              x={362 + indent}
              y={rowTop(i) + 8}
              width={300 * len}
              height="7"
              rx="3"
            />
          </g>
        ))}
      </g>
      <g className="change">
        <rect
          className="sand no-stroke"
          x={SPLIT + 0.75}
          y={rowTop(3)}
          width={395}
          height={PITCH}
        />
        <rect
          className="sage no-stroke"
          x={SPLIT + 0.75}
          y={rowTop(4)}
          width={395}
          height={PITCH}
        />
        <path
          className="o"
          stroke="var(--ill-sand-line)"
          d={`M344 ${rowTop(3) + 11}h8`}
        />
        <path
          className="o"
          stroke="var(--ill-sage-line)"
          d={`M344 ${rowTop(4) + 11}h8M348 ${rowTop(4) + 7}v8`}
        />
        <rect
          className="bar-strong"
          x={380}
          y={rowTop(3) + 8}
          width={300 * 0.58}
          height="6"
          rx="3"
        />
        <rect
          className="bar-strong"
          x={380}
          y={rowTop(4) + 8}
          width={300 * 0.74}
          height="6"
          rx="3"
        />
      </g>
    </>
  );
}
