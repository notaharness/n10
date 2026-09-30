import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  detachSession,
  getSession,
  hasPersistedTerminalSession,
  killSession,
  launchTerminalSession,
  LOCAL_MACHINE,
  releaseExitedSession,
  sessionIdentity,
  type DiscoveredTerminal,
  type TerminalKind,
} from '@n10/core';
import { readConfig } from '@n10/vcs-core';
import { paneDimension } from './session-commands.js';
import { terminalFacts, type TerminalRecord } from './terminal-facts.js';

export interface TerminalLaunch {
  sessionName?: string;
  kind: TerminalKind;
  cwd: string;
  fresh?: boolean;
  cols?: number;
  rows?: number;
  machine?: string;
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
  function watchForEnd(name: string, record: TerminalRecord): void {
    const session = getSession(name);
    if (!session) throw new Error(`Terminal ${name} vanished after launch`);
    session.pty.onExit(() => {
      if (getSession(name) !== session || known.get(name) !== record) return;
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
    });
    const name = launched.name;
    const record = { kind: req.kind, cwd: req.cwd };
    if (req.sessionName && name !== req.sessionName)
      known.delete(req.sessionName);
    known.set(name, record);
    watchForEnd(name, record);
    ports.started(name, req.sessionName);
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
  function resolveRequest(req: TerminalLaunch): TerminalLaunch {
    const existing = req.sessionName ? known.get(req.sessionName) : undefined;
    if (req.sessionName && !existing)
      throw new Error('Unknown terminal session');
    const cwd = existing?.cwd ?? req.cwd;
    const machine = req.sessionName
      ? sessionIdentity(req.sessionName)?.machine
      : req.machine;
    if (!machine || machine === LOCAL_MACHINE) assertLaunchableCwd(cwd);
    return { ...req, cwd, kind: existing?.kind ?? req.kind, machine };
  }
  return {
    async launch(req: TerminalLaunch, onStart?: () => void) {
      const name = await start(resolveRequest(req), undefined, onStart);
      const record = known.get(name);
      if (!record) throw new Error(`Terminal ${name} ended during launch`);
      return terminalFacts(name, record);
    },
    async adopt(terminal: DiscoveredTerminal) {
      const name = await start(
        { sessionName: terminal.name, kind: terminal.kind, cwd: terminal.path },
        'attach'
      );
      const record = known.get(name);
      if (!record) throw new Error(`Terminal ${name} ended during adoption`);
      return terminalFacts(name, record);
    },
    list: () => [...known].map(([name, record]) => terminalFacts(name, record)),
    stop(name: string) {
      if (!known.has(name)) return;
      killSession(name);
      forget(name);
    },
    forget(name: string) {
      if (hasPersistedTerminalSession(name) || !known.has(name)) return;
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
