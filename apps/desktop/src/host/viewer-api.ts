import type { N10HostApi } from './contract.js';
import { IPC } from './contract.js';
import * as sessions from './services/sessions.js';
import type { Viewer } from './services/session-watch.js';

/** Contract methods whose answer depends on which window asked. The
 *  renderer calls them like any other; the handler adds the window. */
export type ViewerScoped =
  | 'watchSession'
  | 'unwatchSession'
  | 'showSession'
  | 'hideSession'
  | 'holdMenuShortcuts'
  | 'takeLaunchRepo';

export type ViewerApi = {
  [K in ViewerScoped]: (
    viewer: Viewer,
    ...args: Parameters<N10HostApi[K]>
  ) => ReturnType<N10HostApi[K]>;
};

/** Main-process glue (`webContents.setIgnoreMenuShortcuts`), injected
 *  by the host worker; a no-op in tests. */
let menuShortcutHold: (
  viewer: Viewer,
  held: boolean
) => Promise<void> = async () => undefined;

export function setMenuShortcutHold(
  fn: (viewer: Viewer, held: boolean) => Promise<void>
): void {
  menuShortcutHold = fn;
}

/** Main-process glue (`main/launch-repo.ts`, where later launches
 *  arrive), injected by the host worker; claims nothing in tests. */
let launchRepoClaim: (viewer: Viewer) => Promise<string | null> = async () =>
  null;

export function setLaunchRepoClaim(
  fn: (viewer: Viewer) => Promise<string | null>
): void {
  launchRepoClaim = fn;
}

export function createViewerApi(): ViewerApi {
  return {
    watchSession: (viewer, name) =>
      Promise.resolve(sessions.watchSession(viewer, name)),
    unwatchSession: (viewer, name) =>
      Promise.resolve(sessions.unwatchSession(viewer, name)),
    showSession: (viewer, name) =>
      Promise.resolve(sessions.showSession(viewer, name)),
    hideSession: (viewer, name) =>
      Promise.resolve(sessions.hideSession(viewer, name)),
    holdMenuShortcuts: (viewer, held) => menuShortcutHold(viewer, held),
    takeLaunchRepo: (viewer) => launchRepoClaim(viewer),
  };
}

/** The viewer-scoped channels, each taking the window first. */
export function viewerHandlers(
  api: ViewerApi
): Record<string, (viewer: Viewer, ...args: never[]) => unknown> {
  return {
    [IPC.watchSession]: api.watchSession,
    [IPC.unwatchSession]: api.unwatchSession,
    [IPC.showSession]: api.showSession,
    [IPC.hideSession]: api.hideSession,
    [IPC.holdMenuShortcuts]: api.holdMenuShortcuts,
    [IPC.takeLaunchRepo]: api.takeLaunchRepo,
  };
}

/** The window an invoke came from: its `webContents` id. */
export function viewerOf(event: unknown): Viewer {
  const id = (event as { sender?: { id?: unknown } } | null)?.sender?.id;
  if (typeof id !== 'number') throw new Error('Invoke without a sender');
  return id;
}
