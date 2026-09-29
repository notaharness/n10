import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal, type TerminalHandle } from '@wterm/react';
import wasmUrl from '@wterm/core/wasm?url';
import { toast } from 'sonner';
import {
  estimateTerminalGrid,
  measureTerminalGrid,
} from '../../lib/terminal-grid.js';
import { useTheme } from '../../lib/theme.js';
import { errorMessage } from '../../lib/utils.js';

/**
 * The terminal of the session on screen, bound to its host PTY.
 *
 * Mounted only while it is shown: the editor mounts the active tab
 * alone, and a review workspace only while its agent pane is up. A
 * session nobody is looking at keeps running in tmux, and the host
 * keeps its emulator, activity and ring buffer; the renderer holds no
 * terminal for it and is sent none of its output.
 *
 * On mount the terminal watches the session (`watchSession`), which
 * answers the host's ring buffer to start from and sends every chunk
 * after it. That is all the scrollback a terminal has on arriving —
 * under tmux, whose own history is the record, a screen or so. `seq`
 * ordering drops any live chunk the snapshot already held. Watching
 * also counts as seeing: while mounted, the session's output never
 * asks for the user's attention.
 */
export function SessionTerminal({
  name,
  epoch,
  disabled,
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
}) {
  const termRef = useRef<TerminalHandle>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const { resolved } = useTheme();

  // Terminal responses and user input can race a session ending. Keep
  // the host's refusal visible without throwing an unhandled rejection
  // for every keystroke or automatic terminal-protocol response.
  const reportError = useCallback(
    (error: unknown) => {
      toast.error(errorMessage(error), { id: `terminal-io:${name}` });
    },
    [name]
  );
  const write = useCallback(
    (data: string) => {
      // Reconnecting: swallow keystrokes rather than send them nowhere.
      if (disabled) return;
      void window.n10.writeSession(name, data).catch(reportError);
    },
    [name, reportError, disabled]
  );
  const resize = useCallback(
    (cols: number, rows: number) => {
      void window.n10.resizeSession(name, cols, rows).catch(reportError);
    },
    [name, reportError]
  );

  useEffect(() => {
    if (!ready) return;
    const term = termRef.current;
    if (!term) return;

    let snapshotSeq: number | null = null;
    const pending: { seq: number; data: string }[] = [];

    // Listening before watching: a chunk pushed the moment the watch
    // lands is queued until the snapshot it follows is written.
    const offData = window.n10.onSessionData(({ name: n, data, seq }) => {
      if (n !== name) return;
      if (snapshotSeq === null) {
        pending.push({ seq, data });
      } else if (seq > snapshotSeq) {
        term.write(data);
      }
    });

    // The snapshot must not land after this effect is torn down: React
    // StrictMode mounts twice in development, so a second one would
    // duplicate the screen, and a pane closing mid-fetch would write
    // into a disposed terminal.
    let cancelled = false;
    void window.n10
      .watchSession(name)
      .then(({ data, seq }) => {
        if (cancelled) return;
        if (data) term.write(data);
        snapshotSeq = seq;
        for (const chunk of pending) {
          if (chunk.seq > seq) term.write(chunk.data);
        }
        pending.length = 0;
      })
      .catch(() => {
        if (cancelled) return;
        snapshotSeq = 0;
        for (const chunk of pending) term.write(chunk.data);
        pending.length = 0;
      });

    return () => {
      cancelled = true;
      offData();
      // Every watch is counted; this one ends with the terminal.
      void window.n10.unwatchSession(name).catch(reportError);
    };
  }, [name, ready, reportError]);

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

  // wterm focuses its input when it starts; this covers a reconnect
  // giving input back, and a terminal mounted while reconnecting.
  useEffect(() => {
    if (ready && !disabled) termRef.current?.focus();
  }, [ready, disabled]);

  // Fit the terminal grid to its pane. autoResize stays ON (with it off
  // the react wrapper pins an inline height of rows*17px and keeps
  // re-applying its cols/rows props, clamping the terminal to ~24 rows).
  // wterm's own observer can still latch a stale size when the pane
  // mounts before layout settles, so this extra observer nudges
  // resize() from the wrapper's real box whenever it changes, using
  // wterm's measured cell metrics so the two observers agree.
  //
  // The first fit always bounces the grid one row, which makes the app
  // repaint its whole screen — the same thing a manual window resize
  // does. A terminal arriving on a tab switch needs that: the snapshot
  // it starts from was drawn for the PTY's grid, and can land before
  // wterm has taken the pane's; once the ring buffer has dropped the
  // attach's first full redraw, what is left repaints only the rows
  // that changed. Fitting alone is not enough, because the PTY already
  // has the pane's grid and skips a same-size SIGWINCH.
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
    // Stays set until a fit has run with a box to measure, so the
    // observer's first callback cannot cancel it.
    let repaint = true;
    const fit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        if (rect.width < 2 || rect.height < 2) return;
        const grid =
          measureTerminalGrid(inst.element, rect) ?? estimateTerminalGrid(rect);
        if (repaint) {
          // Each step reaches the host through wterm's `onResize`.
          repaint = false;
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
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => {
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
