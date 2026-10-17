import type { IDisposable, Terminal } from '@xterm/xterm';
import type { ResolvedTheme } from '../theme.js';

const DSR_SCHEME_QUERY = 996;
const MODE_SCHEME_UPDATES = 2031;

type Params = (number | number[])[];

export interface SchemeReports extends IDisposable {
  /** The theme the terminal paints with now. A program that enabled
   *  mode 2031 is told when its scheme changes. */
  set(theme: ResolvedTheme): void;
}

function schemeReport(theme: ResolvedTheme): string {
  return `\x1b[?997;${theme === 'dark' ? 1 : 2}n`;
}

/**
 * Colour-scheme reports, which xterm.js does not implement: `CSI ? 996 n`
 * is answered with `CSI ? 997 ; 1|2 n` (dark, light), DECRQM for mode
 * 2031 with whether it is set, and while it is set the same report is
 * sent each time the scheme changes. Programs that follow the terminal's
 * theme (tmux 3.6+, and through it Claude Code) use these to learn of a
 * switch; the colours themselves (OSC 10/11) xterm answers from
 * `options.theme`.
 *
 * Replies go through `term.input`, so they reach the program the way
 * xterm's own answers do, through `onData`.
 */
export function installSchemeReports(
  term: Terminal,
  initial: ResolvedTheme
): SchemeReports {
  let theme = initial;
  let updates = false;
  const reply = (data: string) => term.input(data, false);

  const track = (params: Params, set: boolean): boolean => {
    if (params.includes(MODE_SCHEME_UPDATES)) updates = set;
    // The modes set beside it are xterm's.
    return false;
  };
  const { parser } = term;
  const handlers = [
    parser.registerCsiHandler({ prefix: '?', final: 'h' }, (p) =>
      track(p, true)
    ),
    parser.registerCsiHandler({ prefix: '?', final: 'l' }, (p) =>
      track(p, false)
    ),
    parser.registerCsiHandler({ prefix: '?', final: 'n' }, (params) => {
      if (params[0] !== DSR_SCHEME_QUERY) return false;
      reply(schemeReport(theme));
      return true;
    }),
    // xterm answers DECRQM itself, with "not recognized" for 2031.
    parser.registerCsiHandler(
      { prefix: '?', intermediates: '$', final: 'p' },
      (params) => {
        if (params[0] !== MODE_SCHEME_UPDATES) return false;
        reply(`\x1b[?${MODE_SCHEME_UPDATES};${updates ? 1 : 2}$y`);
        return true;
      }
    ),
    // A full reset (RIS) clears every mode, this one too.
    parser.registerEscHandler({ final: 'c' }, () => {
      updates = false;
      return false;
    }),
  ];

  return {
    set: (next) => {
      if (next === theme) return;
      theme = next;
      if (updates) reply(schemeReport(next));
    },
    dispose: () => {
      for (const handler of handlers) handler.dispose();
    },
  };
}
