import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, nativeTheme, shell } from 'electron';
import {
  holdMenuShortcuts,
  releaseMenuShortcutsOnLoad,
} from './menu-shortcuts.js';
import {
  MENU_EVENTS,
  type ContextMenuItem,
  type DesktopPrefs,
  type MenuCommand,
} from '../host/contract.js';
import { loadDesktopPrefs } from '../host/services/desktop-prefs.js';
import { onPageGone, windowPushes } from './host-events.js';
import { startHostProcess, type HostProcess } from './host-process.js';
import { MAIN_MARKS, mark } from './boot-marks.js';
import { pickFolderWithDialog } from './folder-picker.js';
import { buildMenuTemplate } from '../host/menu-template.js';
import { installUnsavedGuard } from './unsaved-guard.js';
import {
  installProcessDiagnostics,
  installRendererRecovery,
} from './renderer-recovery.js';
import {
  isAllowedNavigation,
  loadTarget,
  rendererWebPreferences,
  showWhenReadyOrLoaded,
  windowChrome,
} from './window.js';

mark(MAIN_MARKS.module);

const DIST = join(import.meta.dirname, '..');
const DEV_SERVER_URL = process.env.N10_VITE_URL;
const APP_VERSION = process.env.N10_DESKTOP_VERSION ?? 'dev';
const IS_DEV = Boolean(DEV_SERVER_URL) || APP_VERSION === 'dev';

let prefs: DesktopPrefs = loadDesktopPrefs();
let host: HostProcess | null = null;

// ── Native application menu ──────────────────────────────────────

function sendMenuCommand(command: MenuCommand, arg?: string): void {
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send(MENU_EVENTS.command, { command, arg });
}

function installAppMenu(): void {
  const template = buildMenuTemplate(
    {
      platform: process.platform,
      isDev: IS_DEV,
      theme: prefs.theme,
      appVersion: APP_VERSION,
    },
    sendMenuCommand
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function showAbout(): Promise<void> {
  return dialog
    .showMessageBox({
      type: 'info',
      title: 'About n10 Desktop',
      message: 'n10 Desktop',
      detail: [
        `Version ${APP_VERSION}`,
        `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
        '',
        'Worktrees, agents and reviews for one repository.',
      ].join('\n'),
      buttons: ['OK'],
    })
    .then(() => undefined);
}

function popupContextMenu(items: ContextMenuItem[]): Promise<string | null> {
  return new Promise((resolve) => {
    let chosen: string | null = null;
    const menu = Menu.buildFromTemplate(
      items.map((item) =>
        'type' in item
          ? { type: 'separator' as const }
          : {
              label: item.label,
              enabled: item.enabled ?? true,
              ...(item.checked === undefined
                ? {}
                : { type: 'radio' as const, checked: item.checked }),
              click: () => {
                chosen = item.id;
              },
            }
      )
    );
    const win = BrowserWindow.getFocusedWindow() ?? undefined;
    menu.popup({
      window: win,
      // `click` fires before `callback` when an item is chosen.
      callback: () => resolve(chosen),
    });
  });
}

// Native chrome (overlay window controls, context menus, dialogs)
// follows the resolved theme. Both OS scheme changes and in-app
// Light/Dark picks land here: setting `themeSource` fires 'updated'.
nativeTheme.on('updated', () => {
  if (prefs.nativeFrame) return;
  const next = windowChrome(nativeTheme.shouldUseDarkColors);
  if (next.titleBarOverlay && typeof next.titleBarOverlay === 'object') {
    for (const win of BrowserWindow.getAllWindows()) {
      try {
        win.setTitleBarOverlay(next.titleBarOverlay);
      } catch {
        // not supported on this platform
      }
    }
  }
});

// ── Window ───────────────────────────────────────────────────────

function createMainWindow(): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const chrome = prefs.nativeFrame
    ? { backgroundColor: windowChrome(dark).backgroundColor }
    : windowChrome(dark);

  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'n10',
    show: false,
    autoHideMenuBar: false,
    ...chrome,
    webPreferences: rendererWebPreferences(
      join(DIST, 'preload', 'preload.cjs')
    ),
  });

  const target = loadTarget(
    DEV_SERVER_URL,
    join(DIST, 'renderer', 'index.html')
  );
  if (target.kind === 'dev-server') {
    void win.loadURL(target.url);
  } else {
    void win.loadFile(target.path);
  }

  showWhenReadyOrLoaded(win);
  win.webContents.on('did-finish-load', () => {
    console.log('[desktop] renderer loaded');
    void runQaSteps(win);
  });

  // Links in PR comments etc. open in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  // …and the window itself never leaves the app. A navigation would
  // keep the preload bridge attached, so remote content could drive the
  // host directly; off-site URLs go to the browser instead.
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedNavigation(url, DEV_SERVER_URL)) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) void shell.openExternal(url);
  });

  installRendererRecovery(win);
  releaseMenuShortcutsOnLoad(win.webContents);
  installUnsavedGuard(win);
  return win;
}

// ── Headless QA hook ─────────────────────────────────────────────
// N10_QA_STEPS='[{"js":"...","waitMs":500,"shot":"/tmp/a.png"}]'
// runs each step's JS in the page, waits, captures a PNG, then quits.
// Dev/CI only — lets us screenshot the real app under xvfb.

interface QaStep {
  js?: string;
  waitMs?: number;
  shot?: string;
}

async function runQaSteps(win: BrowserWindow): Promise<void> {
  const raw = process.env.N10_QA_STEPS;
  if (!raw) return;
  let steps: QaStep[] = [];
  try {
    steps = JSON.parse(raw) as QaStep[];
  } catch (err) {
    console.error('[desktop] bad N10_QA_STEPS:', err);
    app.quit();
    return;
  }
  const { writeFile } = await import('node:fs/promises');
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Hidden/occluded windows may never paint, which makes capturePage
  // hang — force the window visible and un-throttled for the run.
  win.show();
  win.focus();
  win.webContents.setBackgroundThrottling(false);
  console.log(`[desktop] qa: ${steps.length} steps`);
  await sleep(1500);
  let i = 0;
  for (const step of steps) {
    i += 1;
    try {
      if (step.js) {
        const r: unknown = await win.webContents.executeJavaScript(
          step.js,
          true
        );
        console.log(`[desktop] qa step ${i} js →`, r);
      }
      await sleep(step.waitMs ?? 600);
      if (step.shot) {
        const img = await win.webContents.capturePage();
        await writeFile(step.shot, img.toPNG());
        console.log(`[desktop] qa step ${i} shot → ${step.shot}`);
      }
    } catch (err) {
      console.error(`[desktop] qa step ${i} failed:`, err);
    }
  }
  app.quit();
}

// ── The session host ─────────────────────────────────────────────
// Every host service runs in its own utility process (host-worker.ts);
// this process forwards the contract to it and does what only it can.

function startHost(): HostProcess {
  const host = startHostProcess({
    pushes: windowPushes,
    shell: {
      pickFolder: pickFolderWithDialog,
      openExternal: async (url) => {
        if (!/^https?:/i.test(url)) throw new Error(`Refusing to open ${url}`);
        await shell.openExternal(url);
      },
      contextMenu: popupContextMenu,
      appMenuPopup: async () => {
        const menu = Menu.getApplicationMenu();
        const win = BrowserWindow.getFocusedWindow() ?? undefined;
        menu?.popup({ window: win });
      },
      aboutBox: showAbout,
      prefsChanged: async (next) => {
        prefs = next;
        nativeTheme.themeSource = next.theme; // recolors overlay + native menus
        installAppMenu(); // theme radio state lives in the menu
      },
      holdMenuShortcuts,
    },
    // The new host has no watches; reloaded pages watch again.
    onRespawn: () => {
      for (const win of BrowserWindow.getAllWindows()) win.webContents.reload();
    },
    // The message says it all; the title only names the app.
    onFailed: (message) => {
      dialog
        .showMessageBox({
          type: 'error',
          title: 'n10',
          message,
          buttons: ['Quit', 'Keep Window Open'],
          defaultId: 0,
        })
        .then(({ response }) => {
          if (response === 0) app.quit();
        })
        .catch((err: unknown) =>
          console.error('[desktop] host failure dialog', err)
        );
    },
  });
  onPageGone((viewer) => host.dropViewer(viewer));
  return host;
}

installProcessDiagnostics();

// ── App lifecycle ────────────────────────────────────────────────

// One instance at a time: a second launch focuses the existing
// window instead of opening a competing (possibly stale-cached) one.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  // A throw in here leaves the app running with no window and no
  // sign of why, so startup failures are logged rather than dropped.
  app
    .whenReady()
    .then(async () => {
      mark(MAIN_MARKS.ready);
      nativeTheme.themeSource = prefs.theme;
      installAppMenu();
      // Only the instance that holds the lock starts a host, so only it
      // rewrites what its sessions run (the host's session bin).
      host = startHost();
      const opened = await host.started;
      mark(MAIN_MARKS.repo);
      console.log(`[desktop] startup repo: ${opened ?? 'none'}`);

      void createMainWindow();
      mark(MAIN_MARKS.window);

      app.on('activate', () => {
        // macOS: re-create the window when the dock icon is clicked and
        // no windows are open.
        if (BrowserWindow.getAllWindows().length === 0) {
          void createMainWindow();
        }
      });
    })
    .catch((err: unknown) => {
      console.error('[desktop] startup failed', err);
      dialog.showErrorBox(
        'n10 could not start',
        err instanceof Error ? err.message : String(err)
      );
      app.quit();
    });
}

app.on('window-all-closed', () => {
  // Unlike macOS, quitting when all windows close is expected on
  // Linux and Windows.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// The host releases its terminal clients (the tmux-hosted processes
// survive app exit) and stops the beam daemon the app started (D15).
// `app.exit`, because an `app.quit` from here can land inside this quit
// and be ignored.
let quitting = false;
app.on('will-quit', (event) => {
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  // A relaunch while this one waits on the host must win, not quit into it.
  app.releaseSingleInstanceLock();
  (host?.stop() ?? Promise.resolve())
    .catch((err: unknown) => console.error('[desktop] host stop', err))
    .finally(() => app.exit());
});
