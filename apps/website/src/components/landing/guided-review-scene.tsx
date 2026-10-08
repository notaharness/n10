import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import styles from './guided-review-scene.module.css';

const STEPS = ['Outline', 'What changes', 'Findings'];

function phase(index: number): CSSProperties {
  return {
    '--guide-delay': `${index === 0 ? 0 : (index - 3) * 6}s`,
  } as CSSProperties;
}

function Slide({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <g className={styles.slide} style={phase(index)} data-still={index === 1}>
      <text x="52" y="88" fontSize="11" className="fill-fd-primary font-mono">
        {STEPS[index]}
      </text>
      <text x="52" y="117" fontSize="19" fontWeight="600">
        {title}
      </text>
      {children}
    </g>
  );
}

function Outline() {
  return (
    <Slide index={0} title="Open the first unresolved thread">
      <text x="52" y="143" fontSize="13" className="fill-fd-muted-foreground">
        The count becomes a way into the review.
      </text>
      {[
        'The count is a way in',
        'An early press waits',
        'Look closely: timing and order',
      ].map((title, i) => (
        <g key={title}>
          <text
            x="54"
            y={180 + i * 28}
            fontSize="12"
            className="fill-fd-primary font-mono"
          >
            {i + 1}
          </text>
          <text x="78" y={180 + i * 28} fontSize="13">
            {title}
          </text>
        </g>
      ))}
    </Slide>
  );
}

function Diagram() {
  return (
    <Slide index={1} title="The count is a way in">
      <text x="52" y="143" fontSize="13" className="fill-fd-muted-foreground">
        One press takes you to the first open thread.
      </text>
      <g fontSize="12" textAnchor="middle" strokeWidth="1.5">
        {[
          { x: 52, label: 'Before', end: 'Find the thread' },
          { x: 252, label: 'After', end: 'Thread opens' },
        ].map(({ x, label, end }) => (
          <g key={label}>
            <text
              x={x + 88}
              y="170"
              className="fill-fd-muted-foreground font-mono"
              fontSize="10"
            >
              {label}
            </text>
            <rect
              x={x}
              y="180"
              width="176"
              height="28"
              rx="5"
              fill="var(--color-fd-accent)"
              stroke="var(--color-fd-border)"
            />
            <text x={x + 88} y="198">
              2 unresolved
            </text>
            <path
              d={`M${x + 88} 211v21m-4-4 4 4 4-4`}
              pathLength="1"
              className={styles.trace}
              fill="none"
              stroke="var(--color-fd-primary)"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x={x}
              y="238"
              width="176"
              height="28"
              rx="5"
              fill="var(--color-fd-background)"
              stroke={
                label === 'After'
                  ? 'var(--color-fd-primary)'
                  : 'var(--color-fd-border)'
              }
            />
            <text x={x + 88} y="256">
              {end}
            </text>
          </g>
        ))}
      </g>
    </Slide>
  );
}

function Findings() {
  return (
    <Slide index={2} title="Look closely: timing and order">
      <text x="52" y="143" fontSize="13" className="fill-fd-muted-foreground">
        Check the likely problems, then the tradeoffs.
      </text>
      {[
        ['01', 'Timing', 'The row may not be ready yet.'],
        ['02', 'Order', 'Which open thread comes first?'],
      ].map(([rank, title, detail], i) => (
        <g key={rank}>
          <rect
            x="52"
            y={163 + i * 50}
            width="3"
            height="36"
            rx="1.5"
            fill={i === 0 ? 'var(--n10-sand)' : 'var(--n10-sage)'}
          />
          <text
            x="66"
            y={178 + i * 50}
            fontSize="11"
            className="fill-fd-primary font-mono"
          >
            {rank}
          </text>
          <text x="94" y={178 + i * 50} fontSize="13" fontWeight="600">
            {title}
          </text>
          <text
            x="94"
            y={196 + i * 50}
            fontSize="12"
            className="fill-fd-muted-foreground"
          >
            {detail}
          </text>
        </g>
      ))}
    </Slide>
  );
}

/** A compact version of the sample PR's guide, in the site's SVG palette. */
export function GuidedReviewScene() {
  return (
    <figure>
      <svg
        viewBox="0 0 480 344"
        role="img"
        aria-label="A guided review carousel: an outline, a before-and-after diagram linking the unresolved count to its thread, and ranked findings. Previous and next arrows sit beside the slide dots."
        className="h-auto w-full fill-fd-foreground font-sans"
      >
        <rect
          x="46"
          y="26"
          width="388"
          height="276"
          rx="8"
          fill="var(--n10-sand)"
          opacity="0.12"
        />
        <rect
          x="38"
          y="34"
          width="404"
          height="276"
          rx="8"
          fill="var(--n10-sage)"
          opacity="0.16"
        />
        <rect
          x="28"
          y="44"
          width="424"
          height="280"
          rx="8"
          fill="var(--color-fd-background)"
          stroke="var(--color-fd-border)"
          strokeWidth="1.5"
        />
        <Outline />
        <Diagram />
        <Findings />
        <path d="M28 282H452" stroke="var(--color-fd-border)" />
        <g
          fill="none"
          stroke="var(--color-fd-primary)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M68 303H52m6-6-6 6 6 6" />
          <path d="M412 303h16m-6-6 6 6-6 6" />
        </g>
        <g fontSize="11" className="fill-fd-muted-foreground font-mono">
          <text x="78" y="307">
            Previous
          </text>
          <text x="370" y="307">
            Next
          </text>
        </g>
        {STEPS.map((label, i) => (
          <g key={label}>
            <rect
              x={216 + i * 20}
              y="300"
              width="12"
              height="5"
              rx="2.5"
              fill="var(--color-fd-border)"
            />
            <rect
              x={216 + i * 20}
              y="300"
              width="12"
              height="5"
              rx="2.5"
              fill="var(--color-fd-primary)"
              className={styles.dot}
              style={phase(i)}
              data-still={i === 1}
            />
          </g>
        ))}
      </svg>
      <figcaption className="hidden px-6 pb-5 lg:block">
        <Link
          href="#desktop-demo"
          className="text-fd-primary group inline-flex items-center gap-1 text-sm font-medium"
        >
          Try it in the desktop preview
          <ArrowRight
            className="size-3.5 transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
        <p className="text-fd-muted-foreground mt-1 text-xs">
          Start a review of PR #175, then open Guided review in the rail.
        </p>
      </figcaption>
    </figure>
  );
}
