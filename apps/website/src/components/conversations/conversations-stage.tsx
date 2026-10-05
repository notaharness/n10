'use client';

import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { SCENES, STILL, type Scene } from './stage-script';
import {
  Badge,
  Bars,
  TOPIC_COLORS,
  ConversationRow,
  Mono,
  Pointer,
  PromptBox,
  Said,
  Window,
  You,
} from './terminal-parts';

const REDUCED = '(prefers-reduced-motion: reduce)';

function subscribeReduced(onChange: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const W = 480;
const H = 320;
const SIDEBAR = 300;
const ROW_W = 172;
const ROWS = { main: 78, ci: 106, tests: 134, changelog: 162 };
const CURSOR = {
  away: [450, 300],
  changelog: [392, 160],
  main: [420, 76],
} as const;

/** Steps through stage-script.ts on a loop; holds one scene when still. */
function useScene(playing: boolean): Scene {
  // Starts from the still, so hydrating doesn't drop every marker.
  const [step, setStep] = useState(STILL);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(
      () => setStep((s) => (s + 1) % SCENES.length),
      (SCENES[step] as Scene).ms
    );
    return () => clearTimeout(timer);
  }, [playing, step]);
  if (playing) return SCENES[step] as Scene;
  return { ...(SCENES[STILL] as Scene), cursor: 'away' };
}

/** Fades and lifts its children in when `on`. */
function Appear({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <g className="conversations-appear" data-on={on}>
      {children}
    </g>
  );
}

function MainView({ scene }: { scene: Scene }) {
  const pointers = [
    { name: 'CI #312', color: TOPIC_COLORS.ci, text: '2 checks failed' },
    { name: 'Flaky test', color: TOPIC_COLORS.tests, text: 'cause found' },
    { name: 'Changelog', color: TOPIC_COLORS.changelog, text: 'needs you' },
  ];
  return (
    <g className="conversations-view" data-on={scene.view === 'main'}>
      <You x={16} y={54}>
        fix the login redirect
      </You>
      <Bars x={16} y={84} widths={[230, 196, 120]} />
      {pointers.map((p, i) => (
        <Appear key={p.name} on={scene.pointers > i}>
          <Pointer x={16} y={150 + i * 24} {...p} />
        </Appear>
      ))}
    </g>
  );
}

function ChangelogView({ scene }: { scene: Scene }) {
  return (
    <g className="conversations-view" data-on={scene.view === 'changelog'}>
      <circle cx={20} cy={49.5} r={4} fill={TOPIC_COLORS.changelog} />
      <Mono x={32} y={54} weight={600}>
        Changelog
      </Mono>
      <Bars x={16} y={86} widths={[220, 150]} />
      <Said x={16} y={132}>
        Mention the --strict flag?
      </Said>
      <Appear on={scene.sent}>
        <You x={16} y={164}>
          yes, under Breaking
        </You>
      </Appear>
      <Appear on={scene.replied}>
        <Said x={16} y={196}>
          Added under Breaking.
        </Said>
      </Appear>
    </g>
  );
}

/** The reply typed into the prompt, revealed by a cover sliding off it. */
function Typing({ scene }: { scene: Scene }) {
  const shown = scene.typed && !scene.sent;
  const clip = useId();
  return (
    <g>
      <clipPath id={clip}>
        <rect x={38} y={280} width={248} height={24} />
      </clipPath>
      <g className="conversations-view" data-on={shown}>
        <Mono x={40} y={295.5}>
          yes, under Breaking
        </Mono>
      </g>
      <g clipPath={`url(#${clip})`}>
        <rect
          x={38}
          y={280}
          width={160}
          height={24}
          className="conversations-type-cover"
          data-on={shown}
          fill="var(--color-fd-background)"
        />
      </g>
    </g>
  );
}

function Sidebar({ scene }: { scene: Scene }) {
  const selected = ROWS[scene.view];
  return (
    <g>
      <path d={`M${SIDEBAR - 8} 27V${H - 1}`} stroke="var(--color-fd-border)" />
      <Mono x={SIDEBAR + 4} y={52} size={11} muted>
        Conversations
      </Mono>
      <rect
        x={SIDEBAR}
        y={-17}
        width={ROW_W}
        height={26}
        rx={5}
        fill="var(--color-fd-accent)"
        className="conversations-highlight"
        style={{ '--conversations-y': `${selected}px` } as CSSProperties}
      />
      <ConversationRow
        x={SIDEBAR}
        y={ROWS.main}
        width={ROW_W}
        color={TOPIC_COLORS.main}
        name="Main"
      />
      <ConversationRow
        x={SIDEBAR}
        y={ROWS.ci}
        width={ROW_W}
        color={TOPIC_COLORS.ci}
        name="CI #312"
        marker={
          <Appear on={scene.ci > 0}>
            <Badge
              x={SIDEBAR + ROW_W - 8}
              y={ROWS.ci}
              marker={{ kind: 'unread', count: 1 }}
            />
          </Appear>
        }
      />
      <ConversationRow
        x={SIDEBAR}
        y={ROWS.tests}
        width={ROW_W}
        color={TOPIC_COLORS.tests}
        name="Flaky test"
        marker={
          <Appear on={scene.tests > 0}>
            <Badge
              x={SIDEBAR + ROW_W - 8}
              y={ROWS.tests}
              marker={{ kind: 'unread', count: 1 }}
            />
          </Appear>
        }
      />
      <ConversationRow
        x={SIDEBAR}
        y={ROWS.changelog}
        width={ROW_W}
        color={TOPIC_COLORS.changelog}
        name="Changelog"
        marker={
          <Appear on={scene.needsYou}>
            <Badge
              x={SIDEBAR + ROW_W - 8}
              y={ROWS.changelog}
              marker={{ kind: 'you' }}
            />
          </Appear>
        }
      />
    </g>
  );
}

function Cursor({ scene }: { scene: Scene }) {
  const [x, y] = CURSOR[scene.cursor];
  return (
    <g
      className="conversations-cursor"
      data-on={scene.cursor !== 'away'}
      style={
        {
          '--conversations-x': `${x}px`,
          '--conversations-y': `${y}px`,
        } as CSSProperties
      }
    >
      <path
        d="M0 0V16L4.5 12L7.5 19L10.5 17.7L7.5 11H13Z"
        fill="var(--color-fd-foreground)"
        stroke="var(--color-fd-background)"
        strokeWidth={1.2}
        strokeLinejoin="round"
      />
    </g>
  );
}

/**
 * A Claude Code session with the sidebar docked. Updates arrive in
 * three conversations while Main gets a pointer to each; the cursor
 * opens the one that needs you, a reply goes there, and it returns to
 * Main. Under prefers-reduced-motion it holds the moment every
 * marker is up.
 */
export function ConversationsStage({ className }: { className?: string }) {
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => true
  );
  const scene = useScene(!reduced);
  return (
    <figure className={className}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="conversations-stage h-auto w-full"
        role="img"
        aria-label="A Claude Code session with a sidebar listing Main, CI #312, Flaky test and Changelog. Updates arrive as unread badges, and Changelog is marked as needing you. Clicking Changelog shows only that conversation; a reply is typed there, then the view returns to Main, where each update appears as a one-line pointer."
      >
        <Window width={W} height={H}>
          <MainView scene={scene} />
          <ChangelogView scene={scene} />
          <PromptBox x={16} y={276} width={SIDEBAR - 32} />
          <Typing scene={scene} />
          <Sidebar scene={scene} />
          <Cursor scene={scene} />
        </Window>
      </svg>
    </figure>
  );
}
