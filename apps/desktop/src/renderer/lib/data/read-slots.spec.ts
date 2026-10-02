import { describe, expect, it } from 'vitest';
import { createReadSlots } from './read-slots.js';

/** Work that finishes when told to, and says when it started. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { done, open };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createReadSlots', () => {
  it('runs at most `max` at once, in the order asked', async () => {
    const slots = createReadSlots(2);
    const started: number[] = [];
    const gates = [gate(), gate(), gate(), gate()];
    const runs = gates.map((g, i) =>
      slots.run(new AbortController().signal, async () => {
        started.push(i);
        await g.done;
        return i;
      })
    );
    await tick();
    expect(started).toEqual([0, 1]);
    gates[1]!.open();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0]!.open();
    gates[2]!.open();
    gates[3]!.open();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
  });

  it('drops a waiter whose signal aborts, without running it', async () => {
    const slots = createReadSlots(1);
    const first = gate();
    const ran: string[] = [];
    const held = slots.run(new AbortController().signal, async () => {
      ran.push('first');
      await first.done;
    });
    const cancel = new AbortController();
    const dropped = slots.run(cancel.signal, async () => {
      ran.push('dropped');
    });
    const next = slots.run(new AbortController().signal, async () => {
      ran.push('next');
    });
    cancel.abort();
    await expect(dropped).rejects.toThrow('cancelled');
    first.open();
    await Promise.all([held, next]);
    expect(ran).toEqual(['first', 'next']);
  });

  it('frees the slot when the work fails', async () => {
    const slots = createReadSlots(1);
    const signal = new AbortController().signal;
    await expect(
      slots.run(signal, () => Promise.reject(new Error('git failed')))
    ).rejects.toThrow('git failed');
    expect(await slots.run(signal, async () => 'after')).toBe('after');
  });
});
