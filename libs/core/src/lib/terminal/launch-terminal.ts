import type { AppConfig } from '@n10/vcs-core';
import type { NamedPtyEntry } from '../pty-registry.js';
import { buildAgentLaunch } from '../session/launch-session.js';
import { openSession } from '../session/open-session.js';
import { requireMachine } from '../machine-registry.js';
import { LOCAL_MACHINE, sessionIdentity } from '../session-key.js';
import { resolveShell } from './shell.js';
import type { TerminalKind } from './terminal-name.js';
import type { SessionTarget } from '@n10/terminal';

export interface TerminalLaunchParams {
  /** Existing qualified terminal key. Omit to create a new terminal. */
  name?: string;
  mode?: 'open' | 'attach';
  /** Start a fresh conversation with the directory's configured agent. */
  fresh?: boolean;
  kind: TerminalKind;
  cwd: string;
  cols: number;
  rows: number;
  config: AppConfig;
  /** A beam peerId, or omitted for local (decisions.md D2). Only
   *  meaningful for a fresh terminal — `params.name`, when qualified
   *  (D2's key), already carries whatever machine it was created on. */
  machine?: string;
  restore?: {
    target: SessionTarget;
    tags: Record<string, string>;
    agent?: string;
    env?: Record<string, string>;
    conversationId?: string;
  };
}

/** A restart's key (when qualified) always wins over the request's own
 *  `machine`: a retained terminal already lives on whatever machine it
 *  was created on. Split out to keep `launchTerminalSession`'s own
 *  complexity within budget. */
function terminalIdentity(params: TerminalLaunchParams) {
  const key = params.name ? sessionIdentity(params.name) : null;
  if (params.name && key?.kind !== 'terminal')
    throw new Error('Expected a qualified terminal key');
  return {
    target: key?.kind === 'terminal' ? key.id : undefined,
    machine: key?.kind === 'terminal' ? key.machine : params.machine,
  };
}

/** A login shell of the configured kind, resolved on the machine the
 *  terminal opens on. */
async function shellLaunch(config: AppConfig, machine: string | undefined) {
  const executor =
    machine && machine !== LOCAL_MACHINE
      ? requireMachine(machine).executor
      : undefined;
  return {
    spec: { cmd: await resolveShell(config.shell, executor), args: ['-l'] },
  };
}

/** Terminal intent is explicit in core; no tags are used as internal flags. */
export async function launchTerminalSession(
  params: TerminalLaunchParams
): Promise<NamedPtyEntry> {
  const identity = terminalIdentity(params);
  return openSession({
    session: {
      type: 'terminal',
      kind: params.kind,
      repo: params.cwd,
      target: identity.target,
      machine: identity.machine,
    },
    mode: params.name ? params.mode : 'create',
    fresh: params.kind === 'agent' && params.fresh,
    intent: params.kind === 'agent' && params.fresh ? 'fresh' : 'continue',
    cwd: params.cwd,
    cols: params.cols,
    rows: params.rows,
    restore: params.restore,
    build: (previous, restarting) =>
      params.kind === 'shell'
        ? shellLaunch(params.config, identity.machine)
        : buildAgentLaunch(
            {
              config: params.restore?.agent
                ? {
                    ...params.config,
                    agentId: params.restore.agent as AppConfig['agentId'],
                  }
                : params.config,
              request: {
                intent: params.fresh ? 'blank' : 'continue-or-blank',
                conversationId: params.restore?.conversationId,
              },
            },
            previous ?? params.restore?.agent,
            restarting || !!params.restore
          ),
  });
}
