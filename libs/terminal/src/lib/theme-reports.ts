import type xtermHeadless from '@xterm/headless';
import type { IDisposable } from '@xterm/headless';

type Terminal = InstanceType<(typeof xtermHeadless)['Terminal']>;

/** The colours a terminal's renderer paints with, as the program it
 *  runs may ask for them. */
export interface TerminalColors {
  /** Reported to programs that enabled colour-scheme updates. */
  scheme: 'light' | 'dark';
  /** `#rrggbb`, the answer to an OSC 10 query. */
  foreground: string;
  /** `#rrggbb`, the answer to an OSC 11 query. */
  background: string;
}

const DSR_SCHEME_QUERY = 996;
const MODE_SCHEME_UPDATES = 2031;
const OSC_FOREGROUND = 10;
const OSC_BACKGROUND = 11;

/** xterm's `rgb:rrrr/gggg/bbbb` form of `#rrggbb`. */
function xtermRgb(hex: string): string {
  const channel = (i: number) => hex.slice(i, i + 2).repeat(2);
  return `rgb:${channel(1)}/${channel(3)}/${channel(5)}`;
}

function schemeReport(scheme: TerminalColors['scheme']): string {
  return `\x1b[?997;${scheme === 'dark' ? 1 : 2}n`;
}

/**
 * The theme reports a headless terminal makes on behalf of the
 * renderer that paints it: OSC 10/11 colour queries answered, and the
 * colour-scheme updates of mode 2031 — `CSI ? 996 n` answered and,
 * while the program has the mode set, `CSI ? 997 ; 1|2 n` sent when the
 * scheme changes. Under tmux the program is tmux itself, which asks its
 * client terminal and passes the answers to its panes.
 *
 * Replies leave through `reply`, not xterm's `onData`, whose other
 * answers (device attributes, cursor reports) the renderer's terminal
 * gives. With no colours set nothing is answered.
 */
export class ThemeReports {
  private colors: TerminalColors | null = null;
  private schemeUpdates = false;
  private readonly handlers: IDisposable[];

  constructor(
    terminal: Terminal,
    private readonly reply: (data: string) => void
  ) {
    const { parser } = terminal;
    this.handlers = [
      parser.registerOscHandler(OSC_FOREGROUND, (data) =>
        this.answerColors(OSC_FOREGROUND, data)
      ),
      parser.registerOscHandler(OSC_BACKGROUND, (data) =>
        this.answerColors(OSC_BACKGROUND, data)
      ),
      parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) =>
        this.trackMode(params, true)
      ),
      parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) =>
        this.trackMode(params, false)
      ),
      parser.registerCsiHandler({ prefix: '?', final: 'n' }, (params) =>
        this.answerScheme(params)
      ),
    ];
  }

  set(colors: TerminalColors | null): void {
    const before = this.colors?.scheme;
    this.colors = colors;
    if (colors && colors.scheme !== before && this.schemeUpdates) {
      this.reply(schemeReport(colors.scheme));
    }
  }

  dispose(): void {
    for (const handler of this.handlers) handler.dispose();
  }

  /** `OSC 10 ; ? ; ? ST` asks for the foreground, then the background:
   *  each `?` is the next colour along. Setting a colour is xterm's. */
  private answerColors(first: number, data: string): boolean {
    const { colors } = this;
    const asked = data.split(';');
    if (!colors || asked.some((part) => part !== '?')) return false;
    asked.forEach((_, i) => {
      const slot = first + i;
      const hex =
        slot === OSC_FOREGROUND
          ? colors.foreground
          : slot === OSC_BACKGROUND
          ? colors.background
          : null;
      if (hex) this.reply(`\x1b]${slot};${xtermRgb(hex)}\x1b\\`);
    });
    return true;
  }

  /** Watches DECSET/DECRST for mode 2031 and leaves the rest to xterm. */
  private trackMode(params: (number | number[])[], set: boolean): boolean {
    if (params.includes(MODE_SCHEME_UPDATES)) this.schemeUpdates = set;
    return false;
  }

  private answerScheme(params: (number | number[])[]): boolean {
    if (params[0] !== DSR_SCHEME_QUERY || !this.colors) return false;
    this.reply(schemeReport(this.colors.scheme));
    return true;
  }
}
