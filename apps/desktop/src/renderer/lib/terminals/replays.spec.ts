import { Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';
import { replays } from './replays.js';

const DA1 = '\x1b[c';
const DA1_REPLY = '\x1b[?1;2c';

let term: Terminal;

afterEach(() => term.dispose());

function terminal() {
  term = new Terminal();
  const replayed = replays(term);
  const sent: string[] = [];
  replayed.onData((data) => sent.push(data));
  const parsed = () => new Promise<void>((resolve) => term.write('', resolve));
  return { replayed, sent, parsed };
}

describe('replays', () => {
  it('sends no reply to a query in replayed output', async () => {
    const { replayed, sent, parsed } = terminal();
    replayed.write(`screen${DA1}`);
    await parsed();
    expect(sent).toEqual([]);
  });

  it('answers a query written after the replay, in the same tick', async () => {
    const { replayed, sent, parsed } = terminal();
    replayed.write(DA1);
    term.write(DA1);
    await parsed();
    expect(sent).toEqual([DA1_REPLY]);
  });

  it('sends input again once the replay is parsed', async () => {
    const { replayed, sent } = terminal();
    await new Promise<void>((resolve) => replayed.write(DA1, resolve));
    term.input('typed');
    expect(sent).toEqual(['typed']);
  });
});
