/**
 * The mouse tracking mode a terminal's output asked for, kept beside
 * wterm because wterm drops any-motion tracking (DECSET 1003): its WASM
 * ignores the mode, so an app that sets it alone gets no mouse at all,
 * and its input handler only reports motion with a button held.
 *
 * `filter` hands wterm 1002 wherever the output says 1003, so wterm
 * still reports presses, releases and drags, and keeps `anyMotion` for
 * the motion with no button held that the terminal reports itself. The
 * rewrite is in place, so a mode set and reset in one chunk keeps its
 * order. xterm turns tracking off on a reset of any tracking mode,
 * wterm only on the one it holds, so a reset of another one resets
 * that too. A sequence cut off at the end of a chunk is held until the next
 * one completes it.
 */
export interface MouseModes {
  /** Output on its way to wterm, as wterm should see it. */
  filter(data: string): string;
  /** True while the app asked for any-motion tracking. */
  readonly anyMotion: boolean;
}

// eslint-disable-next-line no-control-regex -- escape sequences are what this parses
const MODE_SEQ = /\x1b\[\?([\d;]*)([hl])|\x1bc/g;
// eslint-disable-next-line no-control-regex -- escape sequences are what this parses
const PARTIAL = /\x1b(?:\[(?:\?[\d;]*)?)?$/;
/** The tracking modes, of which only one is on at a time (xterm). */
const TRACKING = new Set(['9', '1000', '1001', '1002', '1003']);

export function mouseModes(): MouseModes {
  let anyMotion = false;
  /** The tracking mode wterm holds, as it was handed it. */
  let held: string | null = null;
  let carry = '';

  /** The sequence as wterm should see it, after taking its modes. */
  const rewrite = (params: string[], set: boolean) => {
    const list = params.map((p) => (p === '1003' ? '1002' : p));
    let reset = '';
    for (const p of params) {
      if (!TRACKING.has(p)) continue;
      // Setting another mode replaces this one; resetting any ends it.
      anyMotion = set && p === '1003';
      if (set) {
        if (p === '1003' || p === '1000' || p === '1002')
          held = p === '1000' ? '1000' : '1002';
      } else {
        // wterm ends tracking only on the mode it holds.
        if (held && !list.includes(held)) reset = `\x1b[?${held}l`;
        held = null;
      }
    }
    return `\x1b[?${list.join(';')}${set ? 'h' : 'l'}${reset}`;
  };

  return {
    filter(data) {
      const text = carry + data;
      const cut = PARTIAL.exec(text);
      carry = cut ? cut[0] : '';
      const whole = cut ? text.slice(0, cut.index) : text;
      return whole.replace(MODE_SEQ, (seq, params?: string, final?: string) => {
        if (params === undefined) {
          // RIS: a full reset turns tracking off.
          anyMotion = false;
          held = null;
          return seq;
        }
        return rewrite(params.split(';'), final === 'h');
      });
    },
    get anyMotion() {
      return anyMotion;
    },
  };
}
