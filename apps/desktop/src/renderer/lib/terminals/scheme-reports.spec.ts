import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedTheme } from '../theme.js';
import { installSchemeReports, type SchemeReports } from './scheme-reports.js';

let term: Terminal;
let reports: SchemeReports;
let replies: string[];

function terminal(theme: ResolvedTheme): void {
  term = new Terminal({ allowProposedApi: true });
  reports = installSchemeReports(term, theme);
  replies = [];
  term.onData((data) => replies.push(data));
}

const write = (data: string) =>
  new Promise<void>((resolve) => term.write(data, resolve));

afterEach(() => {
  reports.dispose();
  term.dispose();
});

describe('colour-scheme reports', () => {
  it('answers a colour-scheme query with the scheme it paints with', async () => {
    terminal('dark');
    await write('\x1b[?996n');
    reports.set('light');
    await write('\x1b[?996n');
    expect(replies).toEqual(['\x1b[?997;1n', '\x1b[?997;2n']);
  });

  it('leaves other private status reports to xterm', async () => {
    terminal('dark');
    await write('\x1b[?6n');
    expect(replies).toEqual(['\x1b[?1;1R']);
  });

  it('reports scheme changes only while the program has asked for them', async () => {
    terminal('dark');
    reports.set('light');
    expect(replies).toEqual([]);

    // Set among other modes, as tmux may.
    await write('\x1b[?2004;2031h');
    reports.set('dark');
    reports.set('dark');
    reports.set('light');
    expect(replies).toEqual(['\x1b[?997;1n', '\x1b[?997;2n']);

    await write('\x1b[?2031l');
    reports.set('dark');
    expect(replies).toHaveLength(2);
  });

  // A remounted terminal answers nothing in its replay, `?996n`
  // included, so it tells the program the scheme once it is parsed.
  it('reports the scheme after a replay that set mode 2031', async () => {
    terminal('light');
    reports.replayed();
    expect(replies).toEqual([]);
    await write('\x1b[?2031h');
    reports.replayed();
    expect(replies).toEqual(['\x1b[?997;2n']);
  });

  it('stops reporting after a full reset', async () => {
    terminal('dark');
    await write('\x1b[?2031h\x1bc');
    reports.set('light');
    expect(replies).toEqual([]);
  });

  it('leaves the modes set beside 2031 to xterm', async () => {
    terminal('dark');
    await write('\x1b[?2004;2031h');
    expect(term.modes.bracketedPasteMode).toBe(true);
  });

  it('answers a mode request for 2031 once, and leaves the rest to xterm', async () => {
    terminal('dark');
    await write('\x1b[?2031$p');
    await write('\x1b[?2031h\x1b[?2031$p');
    await write('\x1b[?2004$p');
    expect(replies).toEqual([
      '\x1b[?2031;2$y',
      '\x1b[?2031;1$y',
      '\x1b[?2004;2$y',
    ]);
  });
});
