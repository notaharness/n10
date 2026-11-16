import { describe, expect, it } from 'vitest';
import {
  FIRST_DELAY_MS,
  MAX_DELAY_MS,
  MAX_RESTARTS,
  REMOTE_MAX_DELAY_MS,
  REMOTE_RESTARTS,
  RestartPolicy,
  STABLE_MS,
} from './host-restarts.js';

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RestartPolicy', () => {
  it('backs off, doubling, while each host dies before it has run for long', () => {
    const c = clock();
    const policy = new RestartPolicy(c.now);
    const delays: (number | null)[] = [];
    for (let i = 0; i < MAX_RESTARTS; i++) {
      policy.ready();
      c.advance(STABLE_MS - 1);
      delays.push(policy.ended());
    }
    expect(delays).toEqual([
      FIRST_DELAY_MS,
      FIRST_DELAY_MS * 2,
      FIRST_DELAY_MS * 4,
      Math.min(FIRST_DELAY_MS * 8, MAX_DELAY_MS),
    ]);
  });

  it('gives up after its restarts in a row, whether or not a host got to ready', () => {
    const policy = new RestartPolicy(clock().now);
    for (let i = 0; i < MAX_RESTARTS; i++) {
      expect(policy.ended()).not.toBeNull();
    }
    expect(policy.ended()).toBeNull();
  });

  it('starts over after a host that ran for a while', () => {
    const c = clock();
    const policy = new RestartPolicy(c.now);
    policy.ended();
    policy.ended();
    policy.ready();
    c.advance(STABLE_MS);
    expect(policy.ended()).toBe(FIRST_DELAY_MS);
  });

  it('reconnects a remote host for as long as it takes, at a capped pace', () => {
    const policy = new RestartPolicy(clock().now, REMOTE_RESTARTS);
    const delays = Array.from({ length: 100 }, () => policy.ended());
    expect(delays).not.toContain(null);
    expect(delays.slice(0, 3)).toEqual([
      FIRST_DELAY_MS,
      FIRST_DELAY_MS * 2,
      FIRST_DELAY_MS * 4,
    ]);
    expect(delays.at(-1)).toBe(REMOTE_MAX_DELAY_MS);
  });
});
