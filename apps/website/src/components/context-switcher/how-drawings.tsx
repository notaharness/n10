import type { ReactNode } from 'react';
import {
  Badge,
  Bars,
  CONTEXT_COLORS,
  ContextRow,
  Mono,
  Pointer,
  PromptBox,
  Said,
  Window,
  You,
} from './terminal-parts';

const W = 440;
const H = 260;
const SIDEBAR = 284;
const ROW_W = 148;

function Figure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className="n10-frame h-auto w-full rounded-[10px]"
    >
      <Window width={W} height={H}>
        {children}
      </Window>
    </svg>
  );
}

type Selected = 'main' | 'changelog';

/** The sidebar as both drawings of a whole session show it. */
function Sidebar({ selected }: { selected: Selected }) {
  const right = SIDEBAR + ROW_W - 8;
  return (
    <g>
      <path d={`M${SIDEBAR - 8} 27V${H}`} stroke="var(--color-fd-border)" />
      <ContextRow
        x={SIDEBAR}
        y={56}
        width={ROW_W}
        color={CONTEXT_COLORS.main}
        name="Main chat"
        selected={selected === 'main'}
      />
      <ContextRow
        x={SIDEBAR}
        y={84}
        width={ROW_W}
        color={CONTEXT_COLORS.ci}
        name="CI #312"
        marker={
          <Badge x={right} y={84} marker={{ kind: 'unread', count: 1 }} />
        }
      />
      <ContextRow
        x={SIDEBAR}
        y={112}
        width={ROW_W}
        color={CONTEXT_COLORS.tests}
        name="Flaky test"
        marker={
          <Badge x={right} y={112} marker={{ kind: 'unread', count: 1 }} />
        }
      />
      <ContextRow
        x={SIDEBAR}
        y={140}
        width={ROW_W}
        color={CONTEXT_COLORS.changelog}
        name="Changelog"
        selected={selected === 'changelog'}
      />
    </g>
  );
}

export function MarkersDrawing() {
  const x = 100;
  const width = 240;
  const right = x + width - 10;
  return (
    <Figure label="The sidebar: Main chat, CI #312 with two unread updates, Flaky test with one, Changelog marked as needing you, and a quiet Docs context.">
      <Mono x={x + 4} y={60} size={11} muted>
        Contexts
      </Mono>
      <ContextRow
        x={x}
        y={92}
        width={width}
        color={CONTEXT_COLORS.main}
        name="Main chat"
        selected
      />
      <ContextRow
        x={x}
        y={124}
        width={width}
        color={CONTEXT_COLORS.ci}
        name="CI #312"
        marker={
          <Badge x={right} y={124} marker={{ kind: 'unread', count: 2 }} />
        }
      />
      <ContextRow
        x={x}
        y={156}
        width={width}
        color={CONTEXT_COLORS.tests}
        name="Flaky test"
        marker={
          <Badge x={right} y={156} marker={{ kind: 'unread', count: 1 }} />
        }
      />
      <ContextRow
        x={x}
        y={188}
        width={width}
        color={CONTEXT_COLORS.changelog}
        name="Changelog"
        marker={<Badge x={right} y={188} marker={{ kind: 'you' }} />}
      />
      <ContextRow
        x={x}
        y={220}
        width={width}
        color="var(--n10-sage)"
        name="Docs"
      />
    </Figure>
  );
}

export function TopicDrawing() {
  return (
    <Figure label="Changelog is selected in the sidebar. The transcript shows only that conversation: Claude asks whether to mention the --strict flag, you answer under Breaking, and Claude adds it.">
      <circle cx={20} cy={51.5} r={4} fill={CONTEXT_COLORS.changelog} />
      <Mono x={32} y={56} weight={600}>
        Changelog
      </Mono>
      <Bars x={16} y={86} widths={[200, 140]} />
      <Said x={16} y={130}>
        Mention --strict?
      </Said>
      <You x={16} y={160}>
        yes, under Breaking
      </You>
      <Said x={16} y={190}>
        Added.
      </Said>
      <PromptBox x={16} y={216} width={SIDEBAR - 32} />
      <Sidebar selected="changelog" />
    </Figure>
  );
}

export function MainDrawing() {
  return (
    <Figure label="Main chat is selected. Your conversation with Claude continues, with one-line pointers to updates in CI #312, Flaky test and Changelog between the messages.">
      <You x={16} y={56}>
        fix the login redirect
      </You>
      <Bars x={16} y={86} widths={[210, 150]} />
      <Pointer
        x={16}
        y={130}
        color={CONTEXT_COLORS.ci}
        name="CI #312"
        text="2 failed"
      />
      <Pointer
        x={16}
        y={154}
        color={CONTEXT_COLORS.tests}
        name="Flaky test"
        text="found"
      />
      <Pointer
        x={16}
        y={178}
        color={CONTEXT_COLORS.changelog}
        name="Changelog"
        text="done"
      />
      <PromptBox x={16} y={216} width={SIDEBAR - 32}>
        <Mono x={40} y={235.5}>
          now the logout one
        </Mono>
      </PromptBox>
      <Sidebar selected="main" />
    </Figure>
  );
}
