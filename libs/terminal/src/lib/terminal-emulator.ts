import xtermHeadless from '@xterm/headless';
import type { IDisposable } from '@xterm/headless';

const { Terminal } = xtermHeadless;

type XtermBuffer = InstanceType<typeof Terminal>['buffer']['active'];
type XtermLine = NonNullable<ReturnType<XtermBuffer['getLine']>>;
type XtermCell = ReturnType<XtermBuffer['getNullCell']>;

export type MouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any';

export class TerminalEmulator {
  private terminal: InstanceType<typeof Terminal>;
  private renderDisposables = new Map<() => void, IDisposable>();
  private disposed = false;
  private currentTitle = '';

  /** `scrollback` is how many lines leave the top of the screen before
   *  the oldest is dropped; xterm's own default when omitted. */
  constructor(cols = 80, rows = 24, scrollback?: number) {
    this.terminal = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
      ...(scrollback === undefined ? {} : { scrollback }),
    });
    this.terminal.onTitleChange((title) => {
      this.currentTitle = title;
    });
  }

  write(data: string): Promise<void> {
    return new Promise((resolve) => {
      this.terminal.write(data, resolve);
    });
  }

  render(scrollOffset = 0): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    const start = Math.max(0, buffer.baseY - scrollOffset);
    const cell = buffer.getNullCell();

    for (let i = start; i < start + this.terminal.rows; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(this.renderLine(line, cell));
      }
    }

    while (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    return lines.join('\n');
  }

  private renderLine(line: XtermLine, cell: XtermCell): string {
    const cols = this.terminal.cols;
    let out = '';
    let styled = false;
    let prevSgr = '';

    for (let col = 0; col < cols; col++) {
      line.getCell(col, cell);
      if (!cell || cell.getWidth() === 0) continue;

      if (cell.isAttributeDefault()) {
        if (styled) {
          out += '\x1b[0m';
          styled = false;
          prevSgr = '';
        }
      } else {
        const sgr = this.cellToSgr(cell);
        if (sgr !== prevSgr) {
          out += `\x1b[${sgr}m`;
          styled = true;
          prevSgr = sgr;
        }
      }

      const ch = cell.getChars();
      out += ch || ' ';
    }

    if (styled) {
      out += '\x1b[0m';
    }

    return out.replace(/\s+$/, '');
  }

  private cellToSgr(cell: XtermCell): string {
    const params: (number | string)[] = [];

    if (cell.isBold()) params.push(1);
    if (cell.isDim()) params.push(2);
    if (cell.isItalic()) params.push(3);
    if (cell.isUnderline()) params.push(4);
    if (cell.isBlink()) params.push(5);
    if (cell.isInverse()) params.push(7);
    if (cell.isInvisible()) params.push(8);
    if (cell.isStrikethrough()) params.push(9);
    if (cell.isOverline()) params.push(53);

    this.pushColorSgr(params, cell, 'fg');
    this.pushColorSgr(params, cell, 'bg');

    return params.join(';');
  }

  private pushColorSgr(
    params: (number | string)[],
    cell: XtermCell,
    layer: 'fg' | 'bg'
  ): void {
    const isPalette = layer === 'fg' ? cell.isFgPalette() : cell.isBgPalette();
    const isRGB = layer === 'fg' ? cell.isFgRGB() : cell.isBgRGB();
    const color = layer === 'fg' ? cell.getFgColor() : cell.getBgColor();
    const base = layer === 'fg' ? 30 : 40;
    const brightBase = layer === 'fg' ? 90 : 100;
    const extPrefix = layer === 'fg' ? 38 : 48;

    if (isPalette) {
      if (color < 8) {
        params.push(base + color);
      } else if (color < 16) {
        params.push(brightBase + color - 8);
      } else {
        params.push(`${extPrefix};5;${color}`);
      }
    } else if (isRGB) {
      params.push(
        `${extPrefix};2;${(color >> 16) & 0xff};${(color >> 8) & 0xff};${
          color & 0xff
        }`
      );
    }
  }

  /**
   * The screen as plain text, preceded by up to `history` lines of
   * scrollback: one LF-terminated line per row, trailing blank rows and
   * each row's trailing spaces dropped. Empty when nothing is shown.
   */
  capture(history: number): string {
    const buffer = this.terminal.buffer.active;
    const lines: string[] = [];
    const end = buffer.baseY + this.terminal.rows;
    for (let i = Math.max(0, buffer.baseY - history); i < end; i++)
      lines.push(
        (buffer.getLine(i)?.translateToString(true) ?? '').replace(/ +$/, '')
      );
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines.map((line) => `${line}\n`).join('');
  }

  /** The window title the program last set. */
  get title(): string {
    return this.currentTitle;
  }

  get alternateScreen(): boolean {
    return this.terminal.buffer.active.type === 'alternate';
  }

  get bracketedPaste(): boolean {
    return this.terminal.modes.bracketedPasteMode;
  }

  get applicationCursorKeys(): boolean {
    return this.terminal.modes.applicationCursorKeysMode;
  }

  get maxScrollback(): number {
    return this.terminal.buffer.active.baseY;
  }

  get mouseTrackingMode(): MouseTrackingMode {
    return this.terminal.modes.mouseTrackingMode;
  }

  resize(cols: number, rows: number): void {
    if (!this.disposed) {
      this.terminal.resize(cols, rows);
    }
  }

  onRender(cb: () => void): void {
    const disposable = this.terminal.onWriteParsed(cb);
    this.renderDisposables.set(cb, disposable);
  }

  offRender(cb: () => void): void {
    const disposable = this.renderDisposables.get(cb);
    if (disposable) {
      disposable.dispose();
      this.renderDisposables.delete(cb);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const disposable of this.renderDisposables.values()) {
      disposable.dispose();
    }
    this.renderDisposables.clear();
    this.terminal.dispose();
  }
}
