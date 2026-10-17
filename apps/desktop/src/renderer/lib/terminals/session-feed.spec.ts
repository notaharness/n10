import { describe, expect, it } from 'vitest';
import { sessionFeed } from './session-feed.js';

function attached() {
  const feed = sessionFeed();
  const written: string[] = [];
  feed.attach((d) => written.push(d));
  return { feed, written };
}

describe('sessionFeed', () => {
  it('writes the snapshot, then only the chunks that came after it', () => {
    const { feed, written } = attached();
    feed.live(4, 'already in the snapshot');
    feed.live(5, 'after');
    feed.snapshot('1-4', 4);
    feed.live(4, 'late duplicate');
    feed.live(6, 'live');
    expect(written).toEqual(['1-4', 'after', 'live']);
  });

  it('holds everything until a terminal is attached, in order', () => {
    const feed = sessionFeed();
    feed.snapshot('screen', 2);
    feed.live(3, 'a');
    const written: string[] = [];
    feed.attach((d) => written.push(d));
    feed.live(4, 'b');
    expect(written).toEqual(['screen', 'a', 'b']);
  });

  it('writes nothing for an empty snapshot', () => {
    const { feed, written } = attached();
    feed.snapshot('', 0);
    expect(written).toEqual([]);
  });
});
