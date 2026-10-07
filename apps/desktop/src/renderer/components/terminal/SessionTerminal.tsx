import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  watchSessionFeed,
  type SessionFeed,
} from '../../lib/terminals/session-feed.js';
import {
  openTerminal,
  type DesktopTerminal,
} from '../../lib/terminals/xterm.js';
import { usePaneShown } from '../../lib/tabs/pane-shown.js';
import { resolveTheme, useTheme } from '../../lib/theme.js';
import { errorMessage } from '../../lib/utils.js';

/** The grid that fills the pane, by `FitAddon`'s reckoning; null
 *  before the pane has a box. */
function paneGrid(el: HTMLElement, xterm: DesktopTerminal) {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return xterm.fit.proposeDimensions() ?? null;
}

/**
 * The terminal of the session on screen, bound to its host PTY.
 *
 * Mounted while its pane is on screen, or is the editor's one spare
 * pane, rendered off screen for a switch (`EditorArea`); a review
 * workspace mounts it only while its agent pane is up. A session
 * nobody holds a terminal for keeps running in tmux, and the host keeps
 * its emulator, activity and ring buffer; the renderer is sent none of
 * its output.
 *
 * On mount the terminal watches the session (`watchSession`), which
 * answers the host's ring buffer to start from and sends every chunk
 * after it. That is all the scrollback a terminal has on arriving —
 * under tmux, whose own history is the record, a screen or so. `seq`
 * ordering drops any live chunk the snapshot already held. While its
 * pane is on screen it also shows the session (`showSession`), which
 * counts as seeing: its output does not ask for the user's attention.
 * A spare terminal holds no focus and sees nothing.
 */
export function SessionTerminal({
  name,
  epoch,
  disabled,
  ended,
}: {
  name: string;
  /** When the PTY behind `name` was spawned. Restarting an agent keeps
   *  the name, so this is the only thing that changes when the process
   *  on the other end of this terminal is a new one. */
  epoch: number;
  /** True while `connectionState === 'reconnecting'` (ux-machines.md
   *  §6): keystrokes stop reaching the host, and the pane refuses focus
   *  so they cannot land unseen either — a blocked prompt is better
   *  than one that silently drops what the user typed. */
  disabled?: boolean;
  /** The process ended and tmux kept its dead pane: a read-only view of
   *  its final output. Nothing is sent to the host, neither keystrokes
   *  nor resizes, and the pane refuses focus. */
  ended?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [xterm, setXterm] = useState<DesktopTerminal | null>(null);
  const { resolved } = useTheme();
  const shown = usePaneShown();

  // Terminal responses and user input can race a session ending. Keep
  // the host's refusal visible without throwing an unhandled rejection
  // for every keystroke or automatic terminal-protocol response.
  const reportError = useCallback(
    (error: unknown) => {
      toast.error(errorMessage(error), { id: `terminal-io:${name}` });
    },
    [name]
  );

  // A full repaint the fit effect owes the terminal, and how to ask it
  // for one once it is running.
  const repaintRef = useRef(false);
  const fitRef = useRef<(() => void) | null>(null);
  const requestRepaint = useCallback(() => {
    repaintRef.current = true;
    fitRef.current?.();
  }, []);

  // The terminal's life: watching its session and the xterm drawing it
  // start and end with the element xterm opens in. The watch is asked
  // for first, so the host's answer is on its way while xterm and its
  // WebGL renderer set themselves up, rather than after.
  const feedRef = useRef<SessionFeed | null>(null);
  const hostRef = useCallback(
    (host: HTMLDivElement | null) => {
      if (!host) return undefined;
      const watch = watchSessionFeed(name, {
        onTruncated: requestRepaint,
        onError: reportError,
      });
      feedRef.current = watch.feed;
      const opened = openTerminal(host, resolveTheme());
      setXterm(opened);
      return () => {
        setXterm(null);
        watch.stop();
        if (feedRef.current === watch.feed) feedRef.current = null;
        opened.dispose();
      };
    },
    [name, reportError, requestRepaint]
  );

  useEffect(() => {
    xterm?.setTheme(resolved);
  }, [xterm, resolved]);

  const blocked = disabled || ended;
  const write = useCallback(
    (data: string) => {
      // Reconnecting or ended: swallow keystrokes rather than send them
      // nowhere.
      if (blocked) return;
      void window.n10.writeSession(name, data).catch(reportError);
    },
    [name, reportError, blocked]
  );
  const resize = useCallback(
    (cols: number, rows: number) => {
      if (ended) return;
      void window.n10.resizeSession(name, cols, rows).catch(reportError);
    },
    [name, reportError, ended]
  );

  useEffect(() => {
    if (!xterm) return undefined;
    const data = xterm.term.onData(write);
    const resized = xterm.term.onResize(({ cols, rows }) => resize(cols, rows));
    return () => {
      data.dispose();
      resized.dispose();
    };
  }, [xterm, write, resize]);

  useEffect(() => {
    if (!shown) return;
    void window.n10.showSession(name).catch(reportError);
    return () => void window.n10.hideSession(name).catch(reportError);
  }, [shown, name, reportError]);

  // xterm opens at its default 80x24, and the snapshot was drawn for
  // the PTY's grid: written first, the rows past the default are cut
  // off until the app next redraws. So the terminal takes the pane's
  // grid, then its output.
  useEffect(() => {
    const el = wrapRef.current;
    if (!xterm || !el) return;
    const grid = paneGrid(el, xterm);
    if (grid) xterm.term.resize(grid.cols, grid.rows);
    feedRef.current?.attach((data) => xterm.term.write(data));
  }, [xterm, name]);

  // Pastes go through `term.paste`, which brackets them when the app
  // asked for bracketed paste and hands them to `onData`, so a blocked
  // terminal drops them like keystrokes.
  //
  // Text loses its ESC bytes first, so a clipboard cannot carry
  // `\x1b[201~` to end the bracket early and smuggle the rest in as
  // typed commands. A picture cannot go down a PTY at all: the host
  // writes it to a temp file and the path is pasted, which is how a
  // terminal agent takes an image.
  //
  // Capture phase on the wrapper, so this runs before xterm's own
  // listener on its textarea.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !xterm) return;
    const onPaste = (event: ClipboardEvent) => {
      const data = event.clipboardData;
      if (!data) return;
      event.preventDefault();
      event.stopPropagation();
      const file = [...data.items]
        .find((i) => i.kind === 'file' && i.type.startsWith('image/'))
        ?.getAsFile();
      if (!file) {
        // eslint-disable-next-line no-control-regex -- ESC is the point
        const text = data.getData('text/plain').replace(/\x1b/g, '');
        // Nothing a terminal takes (HTML alone, another kind of file):
        // no paste, not an empty bracket.
        if (text) xterm.term.paste(text);
        return;
      }
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const path = await window.n10.saveClipboardImage(bytes, file.type);
          // Trailing space so whatever the user types next does not run
          // into the path.
          xterm.term.paste(`${path} `);
        } catch (err) {
          toast.error(errorMessage(err));
        }
      })();
    };
    el.addEventListener('paste', onPaste, true);
    return () => el.removeEventListener('paste', onPaste, true);
  }, [xterm]);

  // While reconnecting, focus would take keystrokes `write` then drops,
  // so it is handed back; a reconnect gives it to the terminal again. A
  // spare pane is inert and cannot hold it; being swapped on screen
  // gives it — a frame later, once the press that swapped it has
  // finished moving focus itself (a tab's lets go of it, a sidebar
  // row's takes it).
  useEffect(() => {
    if (!xterm) return undefined;
    if (!blocked && shown) {
      const raf = requestAnimationFrame(() => xterm.term.focus());
      return () => cancelAnimationFrame(raf);
    }
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && wrapRef.current?.contains(focused))
      focused.blur();
    return undefined;
  }, [xterm, blocked, shown]);

  // Fit the terminal grid to its pane whenever the pane's box changes.
  //
  // A snapshot that no longer starts at the attach's full redraw only
  // repaints the rows that changed since, so a terminal starting from
  // one (or from none) bounces its grid one row, which makes the app
  // repaint its whole screen — the same thing a manual window resize
  // does. Fitting alone is not enough, because the PTY already has the
  // pane's grid and skips a same-size SIGWINCH. A complete snapshot
  // needs no bounce, and gets none: the repaint clears the screen it
  // drew and the app draws it again, a flicker on every switch.
  //
  // The host is told the grid on every fit, not only when xterm's grid
  // moved. A launch can only *estimate* the pane, so the PTY starts on
  // a guess and is corrected by the first `onResize` — but restarting
  // an agent in a pane that already holds a correctly-sized terminal
  // moves nothing, emits nothing, and left the new agent drawing itself
  // at the guess until the window was resized. `epoch` is what makes
  // this run again for the new process.
  useEffect(() => {
    const el = wrapRef.current;
    if (!xterm || !el) return;
    const { term } = xterm;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const grid = paneGrid(el, xterm);
        if (!grid) return;
        // Stays owed until a fit has run with a box to measure, so the
        // observer's first callback cannot cancel it.
        if (repaintRef.current) {
          // Each step reaches the host through `onResize`.
          repaintRef.current = false;
          term.resize(grid.cols, grid.rows - 1);
          raf = requestAnimationFrame(() => term.resize(grid.cols, grid.rows));
          return;
        }
        if (grid.cols !== term.cols || grid.rows !== term.rows) {
          term.resize(grid.cols, grid.rows);
          return;
        }
        resize(grid.cols, grid.rows);
      });
    };
    fit();
    fitRef.current = fit;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => {
      if (fitRef.current === fit) fitRef.current = null;
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [xterm, resize, epoch]);

  return (
    <div ref={wrapRef} className="terminal-pane absolute inset-0">
      {disabled && (
        // Blocks a click from refocusing the terminal while
        // reconnecting — content stays visible underneath (ux-machines.md
        // §6), only interaction is refused.
        <div
          aria-hidden
          data-testid="terminal-input-block"
          className="absolute inset-0 z-10 cursor-not-allowed"
        />
      )}
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}
