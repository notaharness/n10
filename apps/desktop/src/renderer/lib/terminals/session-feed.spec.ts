import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sessionFeed,
  watchSessionFeed,
  type FeedSink,
} from './session-feed.js';

/** A sink recording what it is written, a replay marked `replay:`. */
function recorder(written: string[]): FeedSink {
  return {
    write: (d) => written.push(d),
    replay: (d) => written.push(`replay:${d}`),
  };
}

function attached() {
  const feed = sessionFeed();
  const written: string[] = [];
  feed.attach(recorder(written));
  return { feed, written };
}

describe('sessionFeed', () => {
  it('writes the snapshot, then only the chunks that came after it', () => {
    const { feed, written } = attached();
    feed.live(4, 'already in the snapshot');
    feed.live(5, 'after');
    feed.snapshot('1-4', 4, 4);
    feed.live(4, 'late duplicate');
    feed.live(6, 'live');
    expect(written).toEqual(['replay:1-4', 'after', 'live']);
  });

  it('holds everything until a terminal is attached, in order', () => {
    const feed = sessionFeed();
    feed.snapshot('screen', 2, 6);
    feed.live(3, 'a');
    const written: string[] = [];
    feed.attach(recorder(written));
    feed.live(4, 'b');
    expect(written).toEqual(['replay:screen', 'a', 'b']);
  });

  it('writes nothing for an empty snapshot', () => {
    const { feed, written } = attached();
    feed.snapshot('', 0, 0);
    expect(written).toEqual([]);
  });

  it('replays only what a terminal was sent before', () => {
    const { feed, written } = attached();
    feed.snapshot('shownnew', 2, 5);
    expect(written).toEqual(['replay:shown', 'new']);
  });

  it('writes a snapshot no terminal was sent as output', () => {
    const { feed, written } = attached();
    feed.snapshot('setup', 1, 0);
    expect(written).toEqual(['setup']);
  });
});

describe('watchSessionFeed', () => {
  afterEach(() => vi.unstubAllGlobals());

  function host() {
    const calls: string[] = [];
    vi.stubGlobal('window', {
      n10: {
        onSessionData: () => () => undefined,
        watchSession: (name: string) => {
          calls.push(`watch ${name}`);
          return Promise.resolve({
            data: '',
            seq: 0,
            truncated: false,
            replayed: 0,
          });
        },
        unwatchSession: (name: string) => {
          calls.push(`unwatch ${name}`);
          return Promise.resolve();
        },
      },
    });
    return calls;
  }
  const handlers = { onTruncated: () => undefined, onError: () => undefined };

  // The host counts a snapshot it hands out as shown: one StrictMode's
  // first mount asked for and dropped would make the terminal after it
  // replay output nobody answered.
  it('asks for nothing when stopped as it mounts', async () => {
    const calls = host();
    watchSessionFeed('a', handlers).stop();
    const watch = watchSessionFeed('a', handlers);
    await Promise.resolve();
    expect(calls).toEqual(['watch a']);
    watch.stop();
    expect(calls).toEqual(['watch a', 'unwatch a']);
  });
});
