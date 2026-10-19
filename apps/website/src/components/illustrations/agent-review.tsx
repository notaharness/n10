import { Illustration, type Box } from './illustration';
import { Bars, Connector, Pointer } from './parts';
import { appear, arrive, timeline, transient } from './timeline';

/** The final composition's bounds, fitted into the shared frame. */
const BOX: Box = [32, 40, 580, 320];

const css = timeline('agent-review', 11000, {
  anchor: appear(500),
  'draft-a': arrive(600, 0, 10),
  'draft-b': arrive(1700, 0, 10),
  pick: [
    [2900, 'stroke:var(--ill-sage-line)'],
    [3150, 'stroke:var(--ill-primary)'],
  ],
  'to-editor': appear(3500),
  editor: arrive(3600, -14, 0),
  'old-words': [
    [3600, 'opacity:0'],
    [3850, 'opacity:1'],
    [4700, 'opacity:1'],
    [4950, 'opacity:0'],
  ],
  'new-words': [
    [4900, 'opacity:0;transform:scaleX(0.2)'],
    [5000, 'opacity:1;transform:scaleX(0.2)'],
    [5600, 'opacity:1;transform:scaleX(1)'],
  ],
  caret: transient(4700, 5800, 200),
  'b-card': [
    [5600, 'opacity:1'],
    [5900, 'opacity:0.55'],
  ],
  'b-draft': [
    [0, 'opacity:1'],
    [5600, 'opacity:1'],
    [5850, 'opacity:0'],
  ],
  'b-skipped': appear(5850),
  cursor: [
    [6400, 'opacity:0;transform:translate(60px,70px)'],
    [6650, 'opacity:1;transform:translate(60px,70px)'],
    [7250, 'opacity:1;transform:translate(0,0)'],
    [8900, 'opacity:1;transform:translate(0,0)'],
    [9150, 'opacity:0;transform:translate(0,0)'],
  ],
  ring: transient(7450, 7700, 150),
  'to-pr': appear(7900),
  posted: arrive(8000, -16, 0),
});

export function AgentReviewIllustration() {
  return (
    <Illustration
      name="agent-review"
      box={BOX}
      css={css}
      title="An agent's draft becomes your posted comment"
      description="An agent drafts two comments on a diff line, which n10 holds as drafts. You edit one and post it to the pull request thread, where it appears as posted by you. The other draft is skipped and stays unpublished."
    >
      {/* The agent's drafts, held in n10 */}
      <rect className="sage o" x="32" y="40" width="192" height="320" rx="3" />
      <text className="t1" x="46" y="64">
        Drafts in n10
      </text>
      <rect
        className="ground o2"
        x="46"
        y="74"
        width="164"
        height="60"
        rx="2"
      />
      <Bars
        className="bar-strong"
        x={60}
        y={84}
        width={130}
        widths={[0.6, 0.85, 0.45]}
        pitch={16}
        h={5}
      />
      <rect
        className="sage-strong no-stroke"
        x="46.5"
        y="96"
        width="163"
        height="17"
      />
      <rect
        className="bar-strong"
        x={60}
        y={102}
        width={110}
        height={5}
        rx={2.5}
      />
      <path
        className="anchor o"
        stroke="var(--ill-sage-line)"
        d="M53 104.5V154"
      />

      <g className="draft-a">
        <rect
          className="pick ground o"
          stroke="var(--ill-primary)"
          x="46"
          y="154"
          width="164"
          height="86"
          rx="2"
        />
        <text className="t1" x="58" y="178">
          Draft
        </text>
        <text className="t2" x="198" y="177" textAnchor="end">
          medium
        </text>
        <Bars x={58} y={192} width={140} widths={[0.9, 0.7, 0.8]} />
      </g>
      <g className="draft-b">
        <g className="b-card" opacity="0.55">
          <rect
            className="ground o2 wire-dash"
            stroke="var(--ill-sage-line)"
            x="46"
            y="256"
            width="164"
            height="80"
            rx="2"
          />
          <Bars x={58} y={296} width={140} widths={[0.85, 0.55]} />
          <text className="t2" x="198" y="279" textAnchor="end">
            low
          </text>
        </g>
        <text className="t1 b-draft gone" x="58" y="280">
          Draft
        </text>
        <text className="t1 muted b-skipped" x="58" y="280">
          skipped
        </text>
      </g>

      {/* Your edit, then the deliberate post */}
      <Connector
        className="to-editor"
        points={[
          [210, 197],
          [248, 197],
        ]}
      />
      <g className="editor">
        <rect
          className="ground o focus"
          x="248"
          y="120"
          width="168"
          height="152"
          rx="3"
        />
        <text className="t1" x="262" y="146">
          Edit
        </text>
        <Bars x={262} y={162} width={140} widths={[0.88]} />
        <rect className="bar" x="262" y="176" width="44" height="5" rx="2.5" />
        <Bars x={262} y={190} width={140} widths={[0.5]} />
        <rect className="btn" x="262" y="222" width="140" height="36" rx="3" />
        <text className="t1 on-primary" x="332" y="246" textAnchor="middle">
          Post
        </text>
      </g>
      <rect
        className="old-words bar gone"
        x="312"
        y="176"
        width="64"
        height="5"
        rx="2.5"
      />
      <rect
        className="new-words"
        x="312"
        y="175"
        width="84"
        height="7"
        rx="3.5"
        style={{
          fill: 'var(--ill-primary)',
          opacity: 0.55,
          transformOrigin: 'left',
        }}
      />
      <rect
        className="caret gone"
        x="399"
        y="171"
        width="1.5"
        height="15"
        style={{ fill: 'var(--ill-primary)' }}
      />
      <rect
        className="ring gone o focus"
        fill="none"
        x="258"
        y="218"
        width="148"
        height="44"
        rx="5"
      />

      {/* The pull request on the provider */}
      <rect className="sand o" x="440" y="40" width="172" height="320" rx="3" />
      <text className="t1" x="462" y="66">
        PR #42
      </text>
      <rect
        className="ground o2"
        x="462"
        y="80"
        width="132"
        height="22"
        rx="2"
      />
      <rect
        className="bar-strong"
        x="474"
        y="88.5"
        width="90"
        height="5"
        rx="2.5"
      />
      <Connector
        className="to-pr"
        primary
        points={[
          [402, 240],
          [428, 240],
          [428, 166],
          [462, 166],
        ]}
      />
      <g className="posted">
        <path
          className="o"
          stroke="var(--ill-sand-line)"
          fill="none"
          d="M470 102V118"
        />
        <rect
          className="ground o"
          x="462"
          y="118"
          width="132"
          height="96"
          rx="2"
        />
        <rect className="solid-sage" x="474" y="130" width="12" height="12" />
        <Bars x={474} y={156} width={108} widths={[0.9, 0.6]} />
        <rect
          x="474"
          y="179"
          width="64"
          height="7"
          rx="3.5"
          style={{ fill: 'var(--ill-primary)', opacity: 0.55 }}
        />
        <text className="t1 desk" x="462" y="242">
          Posted by you
        </text>
        <text className="t1 phone" x="462" y="244">
          <tspan>Posted</tspan>
          <tspan x="462" dy="26">
            by you
          </tspan>
        </text>
      </g>
      <Pointer x={340} y={242} className="cursor gone" />
    </Illustration>
  );
}
