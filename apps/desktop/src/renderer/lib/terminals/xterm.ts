import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebglAddon } from '@xterm/addon-webgl';
import { toast } from 'sonner';
import type { ResolvedTheme } from '../theme.js';
import { errorMessage, isMac } from '../utils.js';

/**
 * xterm.js as the desktop runs it: one place for the options, the
 * palette and the addons, shared by the terminal on screen and the
 * probe that sizes a launch (`paneTerminalGrid`).
 */

export interface DesktopTerminal {
  term: Terminal;
  fit: FitAddon;
  setTheme(theme: ResolvedTheme): void;
  dispose(): void;
}

const FONT_SIZE = 13;
/** 13px rows of the app's monospace stack come out 18px tall. */
const LINE_HEIGHT = 1.2;

const SELECTION = 'rgba(86, 156, 214, 0.3)';

const DARK: ITheme = {
  foreground: '#d4d4d4',
  cursor: '#aeafad',
  selectionBackground: SELECTION,
  black: '#1e1e1e',
  red: '#f44747',
  green: '#6a9955',
  yellow: '#d7ba7d',
  blue: '#569cd6',
  magenta: '#c586c0',
  cyan: '#4ec9b0',
  white: '#d4d4d4',
  brightBlack: '#808080',
  brightRed: '#f44747',
  brightGreen: '#6a9955',
  brightYellow: '#d7ba7d',
  brightBlue: '#569cd6',
  brightMagenta: '#c586c0',
  brightCyan: '#4ec9b0',
  brightWhite: '#ffffff',
};

const LIGHT: ITheme = {
  foreground: '#383a42',
  cursor: '#526eff',
  selectionBackground: SELECTION,
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#fafafa',
  brightBlack: '#a0a1a7',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#ffffff',
};

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

/** The palette for a theme. The renderers draw with literal colours,
 *  so the app's tokens are read off the document, which carries the
 *  theme's class before anything renders under it. */
function terminalTheme(theme: ResolvedTheme): ITheme {
  const background = cssVar('--term-bg-app');
  return {
    ...(theme === 'light' ? LIGHT : DARK),
    background,
    cursorAccent: background,
  };
}

/** Cmd on macOS, Ctrl elsewhere: what makes a click on a link follow it. */
function linkModifier(event: MouseEvent): boolean {
  return isMac ? event.metaKey : event.ctrlKey;
}

/** An OSC 8 hyperlink, followed on a modified click; xterm hands over
 *  only http(s) links. */
function openLink(event: MouseEvent, uri: string): void {
  if (!linkModifier(event)) return;
  void window.n10.openExternal(uri).catch((error: unknown) => {
    toast.error(errorMessage(error));
  });
}

/**
 * Keys xterm does not take as it would by default. Copy and paste are
 * left to the browser, so the window's Copy and Paste (the Edit menu's
 * roles, or the browser's own) raise the clipboard events xterm and the
 * paste handler act on; Ctrl+C copies only while there is a selection,
 * and without one it is the interrupt. Cmd+Backspace erases the line,
 * as macOS terminals have it.
 *
 * Shift+Enter sends `ESC[13;2u`, the key as the kitty and fixterms
 * protocols spell it, where xterm would send the plain Enter's CR. An
 * agent takes it as a new line rather than a submit (Claude Code's
 * multi-line prompt). xterm 6 implements neither keyboard protocol;
 * this is the sequence wterm sent.
 */
function terminalKey(term: Terminal, event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') return true;
  const mod = event.ctrlKey || event.metaKey;
  if (mod && event.key === 'c' && term.hasSelection()) return false;
  if (mod && event.key === 'v') return false;
  const sequence = ownSequence(event);
  if (sequence === null) return true;
  // Prevented, so no keypress follows to send xterm's own as well.
  event.preventDefault();
  term.input(sequence);
  return false;
}

/** What a key sends in place of xterm's sequence, if anything. */
function ownSequence(event: KeyboardEvent): string | null {
  const { key, shiftKey, ctrlKey, altKey, metaKey } = event;
  if (key === 'Enter' && shiftKey && !ctrlKey && !altKey && !metaKey) {
    return '\x1b[13;2u';
  }
  if (key === 'Backspace' && metaKey && !ctrlKey) return '\x15';
  return null;
}

/**
 * Load the WebGL renderer, and return how to let it go again, context
 * and all; null without WebGL2.
 *
 * Disposing the addon removes its canvas but leaves the canvas's WebGL
 * context alive until the canvas is garbage collected
 * (xtermjs/xterm.js#6068). Chromium keeps 16 contexts in a page and
 * evicts the oldest past that, which can be the terminal on screen, so
 * every mount and unmount would bring that closer. The context is
 * released with `WEBGL_lose_context`, the platform's own call for it,
 * on the canvases the addon added: asking any other canvas for a
 * `webgl2` context could create one.
 *
 * The terminal must be open. Loaded before `open`, the addon waits for
 * it and adds its canvas then, after the look for new canvases, so the
 * context would never be released.
 */
function loadWebgl(
  term: Terminal,
  onContextLoss: () => void
): (() => void) | null {
  const root = term.element;
  if (!root) throw new Error('loadWebgl needs an open terminal');
  const before = new Set(root.querySelectorAll('canvas'));
  const addon = new WebglAddon();
  try {
    term.loadAddon(addon);
  } catch {
    return null;
  }
  addon.onContextLoss(onContextLoss);
  const own = [...root.querySelectorAll('canvas')].filter(
    (c) => !before.has(c)
  );
  return () => {
    addon.dispose();
    for (const canvas of own) {
      const gl = canvas.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}

/**
 * Open a terminal in `host`, sized by `FitAddon` against `host`'s box.
 *
 * WebGL draws it when the GPU allows. A
 * context the browser takes away (memory pressure, a suspend) disposes
 * the addon, as its docs advise, and xterm carries on with its DOM
 * renderer.
 *
 * `host` says which renderer draws (`data-terminal-renderer`, `webgl`
 * or `dom`), the grid (`data-terminal-grid`, `<cols>x<rows>`), the
 * screen (`data-terminal-buffer`, `normal` or `alternate`) and how
 * cursor keys are sent (`data-terminal-cursor-keys`, `normal` or
 * `application`), for whoever inspects the page.
 */
export function openTerminal(
  host: HTMLElement,
  theme: ResolvedTheme
): DesktopTerminal {
  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    fontFamily: cssVar('--font-mono') || 'monospace',
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    theme: terminalTheme(theme),
    linkHandler: { activate: openLink },
    // Shift-drag selects past an app's mouse tracking everywhere but
    // macOS, where xterm offers Option-drag instead, behind this.
    macOptionClickForcesSelection: true,
  });
  term.attachCustomKeyEventHandler((event) => terminalKey(term, event));
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = '11';
  term.open(host);

  const stamp = (renderer: 'webgl' | 'dom') => {
    host.dataset.terminalRenderer = renderer;
  };
  let releaseWebgl: (() => void) | null = null;
  const dropWebgl = () => {
    releaseWebgl?.();
    releaseWebgl = null;
  };
  releaseWebgl = loadWebgl(term, () => {
    dropWebgl();
    stamp('dom');
    // WebGL rounds cells to device pixels and the DOM does not, so
    // the pane holds another grid now; `onResize` tells the PTY.
    fit.fit();
  });
  stamp(releaseWebgl ? 'webgl' : 'dom');
  const grid = () => {
    host.dataset.terminalGrid = `${term.cols}x${term.rows}`;
  };
  grid();
  term.onResize(grid);
  // Modes the output sets, read once each write has been parsed: xterm
  // has no event for a mode changing.
  const modes = () => {
    host.dataset.terminalBuffer = term.buffer.active.type;
    host.dataset.terminalCursorKeys = term.modes.applicationCursorKeysMode
      ? 'application'
      : 'normal';
  };
  modes();
  term.onWriteParsed(modes);

  return {
    term,
    fit,
    setTheme: (next) => {
      term.options.theme = terminalTheme(next);
    },
    dispose: () => {
      dropWebgl();
      term.dispose();
    },
  };
}
