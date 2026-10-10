import { TerminalEmulator } from '@n10/terminal';

/** History a managed session keeps beyond its screen. */
export const SCREEN_HISTORY_LINES = 10_000;

/** What a capture of a managed session's screen says. */
export interface ScreenCapture {
  text: string;
  /** Output chunks the session had written when this was taken. */
  seq: number;
  alternateScreen: boolean;
}

/**
 * The emulated screen of one managed session, kept whether or not
 * anyone views it: what a capture reads, the title and input modes a
 * send honors, and when the session last wrote.
 */
export class ManagedScreen {
  private readonly emulator: TerminalEmulator;
  private written: Promise<void> = Promise.resolve();
  private chunks = 0;
  private lastOutput: number;
  private size: { cols: number; rows: number };

  constructor(cols: number, rows: number) {
    this.size = { cols, rows };
    this.emulator = new TerminalEmulator(cols, rows, SCREEN_HISTORY_LINES);
    this.lastOutput = Math.floor(Date.now() / 1000);
  }

  output(data: string): void {
    this.chunks += 1;
    this.lastOutput = Math.floor(Date.now() / 1000);
    this.written = this.emulator.write(data);
  }

  resize(cols: number, rows: number): void {
    this.size = { cols, rows };
    this.emulator.resize(cols, rows);
  }

  get cols(): number {
    return this.size.cols;
  }

  get rows(): number {
    return this.size.rows;
  }

  /** The screen and up to `history` lines above it, once every write
   *  so far has reached the emulator. */
  async capture(history: number): Promise<ScreenCapture> {
    await this.written;
    return {
      text: this.emulator.capture(history),
      seq: this.chunks,
      alternateScreen: this.emulator.alternateScreen,
    };
  }

  get title(): string {
    return this.emulator.title;
  }

  /** Epoch seconds of the last output; creation until the first. */
  get lastOutputAt(): number {
    return this.lastOutput;
  }

  get bracketedPaste(): boolean {
    return this.emulator.bracketedPaste;
  }

  get applicationCursorKeys(): boolean {
    return this.emulator.applicationCursorKeys;
  }

  dispose(): void {
    this.emulator.dispose();
  }
}
