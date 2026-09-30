/**
 * The channel between the main process and the host utility process
 * (`host-worker.ts`). Contract calls travel as `invoke` by channel
 * name, so the host's whole IPC surface forwards without a line per
 * method; the host's pushes come back as `broadcast` and `send`.
 * `call` is the other direction: what only the main process can do
 * (dialogs, menus, the shell, forking the beam daemon).
 */
import type { ContextMenuItem, DesktopPrefs } from '../host/contract.js';
import type { DaemonExit } from './beam/owned-daemon.js';

/** What the host asks of the main process. */
export interface ShellCalls {
  pickFolder(title: string): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  contextMenu(items: ContextMenuItem[]): Promise<string | null>;
  appMenuPopup(): Promise<void>;
  aboutBox(): Promise<void>;
  prefsChanged(next: DesktopPrefs): Promise<void>;
  /** Forks a beam daemon the host will know as `daemon`; its end
   *  arrives as `daemon-exit`. */
  spawnDaemon(daemon: number, env: Record<string, string>): Promise<void>;
  stopDaemon(daemon: number): Promise<void>;
  killDaemon(daemon: number): Promise<void>;
}

export type MainToHost =
  | {
      t: 'invoke';
      id: number;
      channel: string;
      viewer: number;
      args: unknown[];
    }
  | { t: 'reply'; id: number; ok: true; value: unknown }
  | { t: 'reply'; id: number; ok: false; error: string }
  | { t: 'drop-viewer'; viewer: number }
  | { t: 'daemon-exit'; daemon: number; exit: DaemonExit }
  | { t: 'shutdown' };

export type HostToMain =
  | { t: 'ready'; repo: string | null }
  | { t: 'fatal'; message: string }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }
  | { t: 'call'; id: number; method: keyof ShellCalls; args: unknown[] }
  | { t: 'broadcast'; channel: string; payload?: unknown }
  | { t: 'send'; viewer: number; channel: string; payload: unknown }
  | { t: 'stopped' };

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
