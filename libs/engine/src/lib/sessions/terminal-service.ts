import { paneDimension } from '../kernel/terminal-size.js';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  detachSession,
  directoryOnMachine,
  getSession,
  hasPersistedTerminalSession,
  ORCHESTRA_TAG,
  sessionTags,
  killSession,
  launchTerminalSession,
  LOCAL_MACHINE,
  releaseExitedSession,
  requireMachine,
  sessionIdentity,
  type DiscoveredTerminal,
  type TerminalKind,
  captureTmuxRuntime,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { terminalFacts, type TerminalRecord } from './terminal-facts.js';

export interface TerminalLaunch {
  sessionName?: string;
  kind: TerminalKind;
  cwd: string;
  fresh?: boolean;
  cols?: number;
  rows?: number;
  machine?: string;
  /** `cwd` is the machine's own path, as it reported it, not one named
   *  on this machine. */
  machinePath?: boolean;
  restore?: {
    tmuxName: string;
    tags: Record<string, string>;
    agent?: string;
    env?: Record<string, string>;
    conversationId?: string;
  };
}
export interface TerminalPorts {
  started(name: string, previousName?: string): void;
  ended(name: string): void;
}

function assertLaunchableCwd(cwd: string): void {
  if (!isAbsolute(cwd))
    throw new Error(`Terminal directory must be an absolute path: ${cwd}`);
  let isDir = false;
  try {
    isDir = statSync(cwd).isDirectory();
  } catch {
    // Name an unavailable directory before the backend tries to spawn in it.
  }
  if (!isDir) throw new Error(`Terminal directory does not exist: ${cwd}`);
}

/** The request's directory as the terminal's machine finds it. */
function directoryFor(req: TerminalLaunch, machine?: string): Promise<string> {
  return !machine || machine === LOCAL_MACHINE || req.machinePath
    ? Promise.resolve(req.cwd)
    : directoryOnMachine(req.cwd, requireMachine(machine).executor);
}

function sameSavedTerminal(
  previous: TerminalRecord | undefined,
  req: TerminalLaunch
): boolean {
  if (!req.restore || !previous) return true;
  return (
    previous.cwd === req.cwd &&
    previous.restore?.tmuxName === req.restore.tmuxName &&
    JSON.stringify(previous.restore?.tags) === JSON.stringify(req.restore.tags)
  );
}

function observedRuntime(
  machine: string | undefined,
  tmuxName: string,
  agent?: string
): ReturnType<typeof captureTmuxRuntime> {
  return machine && machine !== LOCAL_MACHINE
    ? {}
    : captureTmuxRuntime(tmuxName, undefined, agent);
}

function launchEnv(req: TerminalLaunch): Record<string, string> | undefined {
  return !req.sessionName && (!req.machine || req.machine === LOCAL_MACHINE)
    ? { CLAUDE_CONFIG_DIR: process.env['CLAUDE_CONFIG_DIR'] ?? '' }
    : undefined;
}

function terminalRuntime(
  req: TerminalLaunch,
  tmuxName: string,
  agent?: string
) {
  const observed = observedRuntime(terminalMachine(req), tmuxName, agent);
  const env = observed.env ?? req.restore?.env ?? launchEnv(req);
  const conversationId = observed.conversationId ?? req.restore?.conversationId;
  return {
    ...(env ? { env } : {}),
    ...(conversationId ? { conversationId } : {}),
  };
}

function terminalTags(req: TerminalLaunch, agent: string | undefined) {
  if (req.restore) return req.restore.tags;
  return {
    ...sessionTags(req.cwd, { type: req.kind }),
    ...(agent ? { [ORCHESTRA_TAG.agent]: agent } : {}),
  };
}

function terminalRecord(
  req: TerminalLaunch,
  launched: Awaited<ReturnType<typeof launchTerminalSession>>,
  name: string
): TerminalRecord {
  const agent = launched.agent ?? req.restore?.agent;
  const tmuxName = launched.pty.name ?? req.restore?.tmuxName ?? name;
  return {
    kind: req.kind,
    cwd: req.cwd,
    restore: {
      tmuxName,
      tags: terminalTags(req, agent),
      ...(agent ? { agent } : {}),
      ...terminalRuntime(req, tmuxName, agent),
    },
  };
}

function terminalMachine(req: TerminalLaunch): string | undefined {
  return req.sessionName
    ? sessionIdentity(req.sessionName)?.machine
    : req.machine;
}

/** Process-wide directory terminals survive repository selection changes. */
export function createTerminalService(ports: TerminalPorts) {
  const known = new Map<string, TerminalRecord>();
  const starting = new Map<
    string,
    { signature: string; promise: Promise<string> }
  >();

  function forget(name: string): void {
    if (known.delete(name)) ports.ended(name);
  }
  function refreshRuntime(name: string, record: TerminalRecord): void {
    const restore = record.restore;
    if (!restore) return;
    const tmuxName = getSession(name)?.pty.name ?? restore.tmuxName;
    const runtime = observedRuntime(
      sessionIdentity(name)?.machine,
      tmuxName,
      restore.agent
    );
    if (!runtime.env && !runtime.conversationId) return;
    record.restore = { ...restore, ...runtime };
  }
  function watchForEnd(name: string, record: TerminalRecord): void {
    const session = getSession(name);
    if (!session) throw new Error(`Terminal ${name} vanished after launch`);
    session.pty.onExit(() => {
      if (getSession(name) !== session || known.get(name) !== record) return;
      refreshRuntime(name, record);
      if (record.kind === 'agent' && hasPersistedTerminalSession(name)) return;
      forget(name);
      releaseExitedSession(name);
    });
  }
  async function performStart(
    req: TerminalLaunch,
    mode?: 'attach',
    onStart?: () => void
  ): Promise<string> {
    const previous = req.sessionName ? known.get(req.sessionName) : undefined;
    const replacing = sameSavedTerminal(previous, req);
    if (!req.sessionName && req.machine && req.machine !== LOCAL_MACHINE)
      onStart?.();
    const launched = await launchTerminalSession({
      name: req.sessionName,
      kind: req.kind,
      cwd: req.cwd,
      cols: paneDimension(req.cols, 120),
      rows: paneDimension(req.rows, 40),
      config: readConfig(req.cwd),
      mode,
      fresh: req.fresh,
      machine: req.sessionName ? undefined : req.machine,
      restore: req.restore,
    });
    const name = launched.name;
    const record = terminalRecord(req, launched, name);
    if (req.sessionName && name !== req.sessionName && replacing)
      known.delete(req.sessionName);
    known.set(name, record);
    watchForEnd(name, record);
    ports.started(name, replacing ? req.sessionName : undefined);
    return name;
  }
  function start(
    req: TerminalLaunch,
    mode?: 'attach',
    onStart?: () => void
  ): Promise<string> {
    const key = req.sessionName;
    if (!key) return performStart(req, mode, onStart);
    const signature = JSON.stringify([
      req.kind,
      req.cwd,
      req.fresh,
      mode,
      req.machine,
      req.restore,
    ]);
    const active = starting.get(key);
    if (active)
      return active.signature === signature
        ? active.promise
        : Promise.reject(
            new Error(
              'Another launch is in progress for this terminal. Try again when it finishes.'
            )
          );
    const promise = performStart(req, mode, onStart).finally(() =>
      starting.delete(key)
    );
    starting.set(key, { signature, promise });
    return promise;
  }
  /** A restart keeps its recorded directory; a fresh remote terminal
   *  opens where its machine finds the requested directory. */
  async function resolveRequest(req: TerminalLaunch): Promise<TerminalLaunch> {
    const existing =
      req.sessionName && !req.restore ? known.get(req.sessionName) : undefined;
    if (req.sessionName && !existing && !req.restore)
      throw new Error('Unknown terminal session');
    const machine = terminalMachine(req);
    const cwd = existing?.cwd ?? (await directoryFor(req, machine));
    if (!machine || machine === LOCAL_MACHINE) assertLaunchableCwd(cwd);
    return { ...req, cwd, kind: existing?.kind ?? req.kind, machine };
  }
  return {
    async launch(req: TerminalLaunch, onStart?: () => void) {
      const name = await start(await resolveRequest(req), undefined, onStart);
      const record = known.get(name);
      if (!record) throw new Error(`Terminal ${name} ended during launch`);
      return terminalFacts(name, record);
    },
    async adopt(terminal: DiscoveredTerminal) {
      const identity = sessionIdentity(terminal.name);
      const name = await start(
        {
          sessionName: terminal.name,
          kind: terminal.kind,
          cwd: terminal.path,
          ...(terminal.tags
            ? {
                restore: {
                  tmuxName:
                    identity?.kind === 'terminal' ? identity.id : terminal.name,
                  tags: terminal.tags,
                  ...(terminal.agent ? { agent: terminal.agent } : {}),
                },
              }
            : {}),
        },
        'attach'
      );
      const record = known.get(name);
      if (!record) throw new Error(`Terminal ${name} ended during adoption`);
      return terminalFacts(name, record);
    },
    list: () =>
      [...known].map(([name, record]) => {
        refreshRuntime(name, record);
        return terminalFacts(name, record);
      }),
    stop(name: string) {
      if (!known.has(name)) return;
      killSession(name);
      forget(name);
    },
    /** Discovery's word that the session is gone. This machine's tmux is
     *  asked again; another machine's word is the listing discovery just
     *  took there, since its backend stops polling a dead pane. */
    forget(name: string) {
      const local = sessionIdentity(name)?.machine === LOCAL_MACHINE;
      if (!known.has(name) || (local && hasPersistedTerminalSession(name)))
        return;
      forget(name);
      detachSession(name);
    },
    has: (name: string) => known.has(name),
    names: (kind?: TerminalKind) =>
      [...known]
        .filter(([, record]) => !kind || record.kind === kind)
        .map(([name]) => name),
  };
}
