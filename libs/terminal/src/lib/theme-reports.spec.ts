import { afterEach, describe, expect, it } from 'vitest';
import { TerminalEmulator } from './terminal-emulator.js';
import type { TerminalColors } from './theme-reports.js';

const DARK: TerminalColors = {
  scheme: 'dark',
  foreground: '#d4d4d4',
  background: '#1e1e1e',
};
const LIGHT: TerminalColors = {
  scheme: 'light',
  foreground: '#383a42',
  background: '#fafafa',
};

let emu: TerminalEmulator;
let replies: string[];

function terminal(colors: TerminalColors | null): void {
  emu = new TerminalEmulator(80, 24);
  replies = [];
  emu.onReply((data) => replies.push(data));
  emu.setThemeColors(colors);
}

afterEach(() => emu.dispose());

describe('theme reports', () => {
  it('answers background and foreground queries with the colours it paints with', async () => {
    terminal(DARK);
    await emu.write('\x1b]11;?\x1b\\');
    await emu.write('\x1b]10;?\x07');
    expect(replies).toEqual([
      '\x1b]11;rgb:1e1e/1e1e/1e1e\x1b\\',
      '\x1b]10;rgb:d4d4/d4d4/d4d4\x1b\\',
    ]);
  });

  it('answers each colour a chained query asks for, in order', async () => {
    terminal(LIGHT);
    await emu.write('\x1b]10;?;?\x1b\\');
    expect(replies).toEqual([
      '\x1b]10;rgb:3838/3a3a/4242\x1b\\',
      '\x1b]11;rgb:fafa/fafa/fafa\x1b\\',
    ]);
  });

  it('answers nothing without colours, and nothing for a colour being set', async () => {
    terminal(null);
    await emu.write('\x1b]11;?\x1b\\\x1b[?996n');
    emu.setThemeColors(DARK);
    await emu.write('\x1b]11;#000000\x1b\\');
    expect(replies).toEqual([]);
  });

  it('answers a colour-scheme query', async () => {
    terminal(DARK);
    await emu.write('\x1b[?996n');
    emu.setThemeColors(LIGHT);
    await emu.write('\x1b[?996n');
    expect(replies).toEqual(['\x1b[?997;1n', '\x1b[?997;2n']);
  });

  it('reports scheme changes only while the program has asked for them', async () => {
    terminal(DARK);
    emu.setThemeColors(LIGHT);
    expect(replies).toEqual([]);

    // Set among other modes, as tmux may.
    await emu.write('\x1b[?2004;2031h');
    emu.setThemeColors(DARK);
    emu.setThemeColors({ ...DARK, background: '#000000' });
    emu.setThemeColors(LIGHT);
    expect(replies).toEqual(['\x1b[?997;1n', '\x1b[?997;2n']);

    await emu.write('\x1b[?2031l');
    emu.setThemeColors(DARK);
    expect(replies).toHaveLength(2);
  });

  it('leaves the modes it watches to xterm', async () => {
    terminal(DARK);
    await emu.write('\x1b[?2004;2031h\x1b[?1000h');
    expect(emu.mouseTrackingMode).toBe('vt200');
  });
});
