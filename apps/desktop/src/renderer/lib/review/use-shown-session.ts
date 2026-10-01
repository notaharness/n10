import { useState } from 'react';
import type { PullRequestInfo } from '@n10/vcs-core/types';
import { useReconnectSession } from '../data/mutations-terminals.js';
import { useMachines } from '../data/queries.js';
import { resolveMachineLabel } from '../machines/machine-model.js';
import { terminalPaneState } from '../terminals/terminal-pane-state.js';
import type { BranchSessionRail } from './use-branch-session-rail.js';
import { useReviewMode } from './use-review-mode.js';
import {
  newSessionNames,
  shownSession,
  type SessionCard,
} from './session-cards.js';

/**
 * Which session's terminal the review pane shows. A session that
 * appears in the list after the first answer was just launched, and
 * takes the pane, as opening a card does: either bumps `focus`, which
 * the pane follows. Adjusted during render, like the pane itself, so
 * the new terminal never waits a frame behind the old one.
 */
export function useShownSession(
  cards: readonly SessionCard[],
  loaded: boolean,
  own: string | undefined
) {
  const [picked, setPicked] = useState<string | null>(null);
  const [focus, setFocus] = useState(0);
  const [seen, setSeen] = useState<readonly SessionCard[] | null>(null);
  const names = cards.map((c) => c.name).join('\n');
  const [seenNames, setSeenNames] = useState<string | null>(null);
  if (loaded && names !== seenNames) {
    const launched = newSessionNames(seen, cards).at(-1);
    setSeen(cards);
    setSeenNames(names);
    if (launched) {
      setPicked(launched);
      setFocus((n) => n + 1);
    }
  }
  const open = (name: string) => {
    setPicked(name);
    setFocus((n) => n + 1);
  };
  return { shown: shownSession(cards, picked, own), open, focus };
}

/** The shown session's connection banner (ux-machines.md §6). */
export function useSessionBanner(shown: SessionCard | undefined) {
  const machines = useMachines();
  const reconnect = useReconnectSession();
  if (!shown) return { connectionBanner: null, inputDisabled: false };
  const pane = terminalPaneState({
    kind: shown.title === 'Terminal' ? 'shell' : 'agent',
    running: shown.running,
    connectionState: shown.connectionState,
  });
  const connectionBanner = pane.bannerState
    ? {
        state: pane.bannerState,
        machineLabel:
          resolveMachineLabel(shown.machine, machines.data) ?? 'this machine',
        onReconnect: () => reconnect.mutate(shown.name),
        reconnecting: reconnect.isPending,
      }
    : null;
  return { connectionBanner, inputDisabled: pane.inputDisabled };
}

/**
 * The review pane and the session it shows: the mode, which session's
 * terminal, and its banner. Opening a card or launching a session hands
 * that session the pane.
 */
export function useSessionPane(
  pr: PullRequestInfo | undefined,
  sessions: BranchSessionRail,
  own: string | undefined
) {
  const view = useShownSession(sessions.cards, sessions.loaded, own);
  const { shown } = view;
  const banner = useSessionBanner(shown);
  const [mode, setMode] = useReviewMode({
    pr,
    agent: {
      hasSession: shown !== undefined,
      running: shown?.running ?? false,
    },
  });
  const [focused, setFocused] = useState(view.focus);
  if (focused !== view.focus) {
    setFocused(view.focus);
    setMode('agent');
  }
  return {
    mode,
    setMode,
    open: view.open,
    banner,
    hasSession: shown !== undefined,
    shownName: shown?.name ?? null,
    epoch: shown?.spawnedAt ?? 0,
  };
}
