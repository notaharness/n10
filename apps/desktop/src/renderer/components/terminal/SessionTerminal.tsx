import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, type TerminalHandle } from '@wterm/react';
import wasmUrl from '@wterm/core/wasm?url';
import { toast } from 'sonner';
import {
  estimateTerminalGrid,
  measureTerminalGrid,
  terminalBox,
} from '../../lib/terminal-grid.js';
import {
  sessionFeed,
  type SessionFeed,
} from '../../lib/terminals/session-feed.js';
import { usePaneShown } from '../../lib/tabs/pane-shown.js';
import { useTheme } from '../../lib/theme.js';
import { errorMessage } from '../../lib/utils.js';

/** The grid that fills the wrapper, reckoned the way wterm's own
 *  observer does (`terminalBox`, in its own cell metrics) so the two
 *  agree; null before the pane has a box. */
function paneGrid(el: HTMLElement, term: TerminalHandle) {
  const inst = term.instance;
  const rect = el.getBoundingClientRect();
  if (!inst || rect.width < 2 || rect.height < 2) return null;
  return (
    measureTerminalGrid(inst.element, terminalBox(inst.element)) ??
    estimateTerminalGrid(rect)
  );
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
  const termRef = useRef<TerminalHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
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

  // A full repaint the fit effect owes the terminal, and how to ask it
  // for one once it is running.
  const repaintRef = useRef(false);
  const fitRef = useRef<(() => void) | null>(null);
  const requestRepaint = useCallback(() => {
    repaintRef.current = true;
    fitRef.current?.();
  }, []);

  // Watching starts on mount, not once wterm is ready: its WASM loads
  // in the meantime, and the host's answer is held until it has.
  const feedRef = useRef<SessionFeed | null>(null);
  useEffect(() => {
    const feed = sessionFeed();
    feedRef.current = feed;
    // Listening before watching: a chunk pushed the moment the watch
    // lands waits for the snapshot it follows.
    const offData = window.n10.onSessionData(({ name: n, data, seq }) => {
      if (n === name) feed.live(seq, data);
    });
    // Nothing may land after this effect is torn down: React StrictMode
    // mounts twice in development, so a second snapshot would duplicate
    // the screen, and a pane closing mid-fetch would write into a
    // disposed terminal.
    let cancelled = false;
    void window.n10
      .watchSession(name)
      .then(({ data, seq, truncated }) => {
        if (cancelled) return;
        feed.snapshot(data, seq);
        if (truncated) requestRepaint();
      })
      .catch((error: unknown) => {
        // The host holds no watch, so nothing will arrive: say so
        // rather than leave a blank terminal.
        if (!cancelled) reportError(error);
      });
    return () => {
      cancelled = true;
      offData();
      if (feedRef.current === feed) feedRef.current = null;
      // Every watch is counted; this one ends with the terminal.
      void window.n10.unwatchSession(name).catch(reportError);
    };
  }, [name, reportError, requestRepaint]);

  useEffect(() => {
    if (!shown) return;
    void window.n10.showSession(name).catch(reportError);
    return () => void window.n10.hideSession(name).catch(reportError);
  }, [shown, name, reportError]);

  // wterm is ready at its default grid, and the snapshot was drawn for
  // the PTY's: written first, the rows past the default are cut off
  // until the app next redraws. So the terminal takes the pane's grid,
  // then its output.
  useEffect(() => {
    const term = termRef.current;
    const el = wrapRef.current;
    if (!ready || !term || !el) return;
    const grid = paneGrid(el, term);
    if (grid) term.resize(grid.cols, grid.rows);
    feedRef.current?.attach((data) => term.write(data));
  }, [ready, name]);

  // Pasting a picture into the terminal.
  //
  // wterm's own paste handler reads `clipboardData.getData('text')` and
  // returns when there is none, so a copied screenshot lands nowhere
  // and the paste looks like it simply did not happen. A PTY carries
  // text, so the image cannot be forwarded as-is: the host writes it to
  // a temp file and we type the path, which is how a terminal agent
  // takes an image.
  //
  // Capture phase on the wrapper, so this runs before wterm's listener
  // on the textarea inside it. Text pastes are left alone — they fall
  // through to wterm, which already brackets and sanitises them.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !ready) return;
    const onPaste = (event: ClipboardEvent) => {
      const file = [...(event.clipboardData?.items ?? [])]
        .find((i) => i.kind === 'file' && i.type.startsWith('image/'))
        ?.getAsFile();
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      void (async () => {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const path = await window.n10.saveClipboardImage(bytes, file.type);
          // Trailing space so whatever the user types next does not run
          // into the path, and bracketed when the app asked for it —
          // the same shape wterm gives a text paste.
          const payload = `${path} `;
          const bracketed =
            termRef.current?.instance?.bridge?.bracketedPaste() === true;
          await window.n10.writeSession(
            name,
            bracketed ? `\x1b[200~${payload}\x1b[201~` : payload
          );
        } catch (err) {
          toast.error(errorMessage(err));
        }
      })();
    };
    el.addEventListener('paste', onPaste, true);
    return () => el.removeEventListener('paste', onPaste, true);
  }, [ready, name]);

  // wterm focuses its input when it starts. While reconnecting that
  // would take keystrokes `write` then drops, so the focus is handed
  // back; a reconnect gives it to the terminal again. A spare pane is
  // inert and cannot hold it; being swapped on screen gives it — a
  // frame later, once the press that swapped it has finished moving
  // focus itself (a tab's lets go of it, a sidebar row's takes it).
  useEffect(() => {
    if (!ready) return undefined;
    if (!blocked && shown) {
      const raf = requestAnimationFrame(() => termRef.current?.focus());
      return () => cancelAnimationFrame(raf);
    }
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && wrapRef.current?.contains(focused))
      focused.blur();
    return undefined;
  }, [ready, blocked, shown]);

  // Fit the terminal grid to its pane. autoResize stays ON (with it off
  // the react wrapper pins an inline height of rows*17px and keeps
  // re-applying its cols/rows props, clamping the terminal to ~24 rows).
  // wterm's own observer can still latch a stale size when the pane
  // mounts before layout settles, so this extra observer nudges
  // resize() from the wrapper's real box whenever it changes, using
  // wterm's measured cell metrics so the two observers agree.
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
  // The host is told the grid on every fit, not only when wterm's own
  // grid moved. A launch can only *estimate* the pane, so the PTY starts
  // on a guess and is corrected by the first `onResize` wterm emits —
  // but restarting an agent in a pane that already holds a
  // correctly-sized terminal moves nothing, emits nothing, and left the
  // new agent drawing itself at the guess until the window was resized.
  // `epoch` is what makes this run again for the new process.
  useEffect(() => {
    if (!ready) return;
    const el = wrapRef.current;
    const term = termRef.current;
    const inst = term?.instance;
    if (!el || !term || !inst) return;
    let raf = 0;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const grid = paneGrid(el, term);
        if (!grid) return;
        // Stays owed until a fit has run with a box to measure, so the
        // observer's first callback cannot cancel it.
        if (repaintRef.current) {
          // Each step reaches the host through wterm's `onResize`.
          repaintRef.current = false;
          term.resize(grid.cols, grid.rows - 1);
          raf = requestAnimationFrame(() => term.resize(grid.cols, grid.rows));
          return;
        }
        if (grid.cols !== inst.cols || grid.rows !== inst.rows) {
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
  }, [ready, resize, epoch]);

  return (
    <div ref={wrapRef} className="absolute inset-0">
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
      <Terminal
        ref={termRef}
        wasmUrl={wasmUrl}
        className="h-full w-full"
        theme={resolved === 'light' ? 'light' : undefined}
        autoResize
        cursorBlink
        onReady={() => setReady(true)}
        onData={write}
        onResize={resize}
      />
    </div>
  );
}
