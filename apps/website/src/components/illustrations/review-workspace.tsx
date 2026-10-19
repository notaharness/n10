import { Illustration, type Box } from './illustration';
import { Bars, Connector, N10Window, Pointer, Tick } from './parts';
import { ReviewSheetAndDiff, rowTop, SPLIT } from './review-workspace-parts';
import { appear, arrive, leave, timeline, transient } from './timeline';

/** The final composition's bounds, fitted into the shared frame. */
const BOX: Box = [24, 24, 672, 376];
const css = timeline('review', 10000, {
  sheet: arrive(200, 0, 10),
  checks: appear(900),
  pick: [
    [1500, 'fill:var(--ill-surface);stroke:var(--ill-rule)'],
    [1750, 'fill:var(--ill-sage);stroke:var(--ill-primary)'],
  ],
  diff: arrive(1800, -14, 0),
  change: appear(2700),
  thread: arrive(3200, 0, 10),
  reply: arrive(4300, 0, 8),
  resolve: transient(3200, 5800),
  resolved: appear(5850),
  cursor: [
    [4900, 'opacity:0;transform:translate(140px,70px)'],
    [5150, 'opacity:1;transform:translate(140px,70px)'],
    [5650, 'opacity:1;transform:translate(0,0)'],
    [6600, 'opacity:1;transform:translate(0,0)'],
    [7300, 'opacity:1;transform:translate(-220px,76px)'],
    [8700, 'opacity:1;transform:translate(-220px,76px)'],
    [8950, 'opacity:0;transform:translate(-220px,76px)'],
  ],
  submit: [...appear(200), ...leave(7800)],
  ring: transient(7450, 7700, 150),
  submitted: appear(7850),
  link: appear(8300, 300),
});

export function ReviewWorkspaceIllustration() {
  return (
    <Illustration
      name="review"
      box={BOX}
      css={css}
      title="Finishing a review inside n10"
      description="Pull request 42 with passing checks sits beside its diff. A thread on the changed line has a reply and is resolved, and the review is submitted from the same window."
    >
      <N10Window
        x={24}
        y={24}
        width={672}
        height={376}
        strip={32}
        label="review"
      >
        <rect
          className="sand no-stroke"
          x="25"
          y="56.75"
          width={SPLIT - 25}
          height="342.5"
        />
        <line
          className="o2"
          stroke="var(--ill-rule)"
          x1={SPLIT}
          x2={SPLIT}
          y1={56}
          y2={400}
        />
      </N10Window>

      <ReviewSheetAndDiff />

      {/* Thread anchored to the added line */}
      <g className="thread">
        <path
          className="o"
          stroke="var(--ill-sage-line)"
          fill="none"
          d={`M330 ${rowTop(4) + 11}V318H348`}
        />
        <rect
          className="solid-sage"
          x="326"
          y={rowTop(4) + 7}
          width="8"
          height="8"
        />
        <rect
          className="ground o"
          x="348"
          y="264"
          width="324"
          height="120"
          rx="3"
        />
        <line
          className="o2"
          stroke="var(--ill-rule)"
          x1={348}
          x2={672}
          y1={302}
          y2={302}
        />
        <rect className="solid-sand" x="364" y="314" width="12" height="12" />
        <Bars x={388} y={314} width={260} widths={[0.82, 0.5]} />
      </g>
      <g className="reply">
        <rect className="solid-sage" x="364" y="348" width="12" height="12" />
        <Bars x={388} y={348} width={260} widths={[0.66, 0.38]} />
        <text className="t2 desk" x="388" y="378">
          you
        </text>
      </g>
      <g className="resolve gone">
        <rect
          className="ground o focus"
          x="356"
          y="268"
          width="120"
          height="30"
          rx="2"
        />
        <text
          className="t1"
          x="416"
          y="291"
          textAnchor="middle"
          style={{ fill: 'var(--ill-primary)' }}
        >
          Resolve
        </text>
      </g>
      <g className="resolved">
        <Tick x={372} y={283} />
        <text className="t1" x="386" y="291">
          Resolved
        </text>
      </g>

      {/* The deliberate submit, and what it produces */}
      <g className="submitted">
        <rect
          className="sage-strong o"
          x="40"
          y="342"
          width="236"
          height="40"
          rx="3"
        />
        <Tick x={62} y={362} className="desk" />
        <text className="t1 desk" x="166" y="368" textAnchor="middle">
          Review submitted
        </text>
        <Tick x={100} y={362} className="phone" />
        <text className="t1 phone" x="118" y="371">
          Submitted
        </text>
      </g>
      <g className="submit gone">
        <rect className="btn" x="40" y="342" width="236" height="40" rx="3" />
        <text className="t1 on-primary" x="158" y="368" textAnchor="middle">
          Submit review
        </text>
      </g>
      <rect
        className="ring gone o focus"
        fill="none"
        x="36"
        y="338"
        width="244"
        height="48"
        rx="5"
      />
      <Connector
        className="link"
        primary
        points={[
          [348, 362],
          [280, 362],
        ]}
      />
      <Pointer x={420} y={286} className="cursor gone" />
    </Illustration>
  );
}
