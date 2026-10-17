/**
 * At most `max` of some work at once, in the order it asked. A waiter
 * whose signal aborts leaves the queue without ever starting, so a
 * cancelled query costs nothing.
 */
export interface ReadSlots {
  run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T>;
}

export function createReadSlots(max: number): ReadSlots {
  let running = 0;
  const waiting: (() => void)[] = [];

  const acquire = async (signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    if (running < max) {
      running++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const abort = () => {
        const i = waiting.indexOf(start);
        if (i >= 0) waiting.splice(i, 1);
        reject(new DOMException('The read was cancelled', 'AbortError'));
      };
      waiting.push(start);
      signal.addEventListener('abort', abort, { once: true });
    });
  };

  // The slot passes straight to the next waiter, so none is overtaken.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else running--;
  };

  return {
    async run(signal, work) {
      await acquire(signal);
      try {
        return await work();
      } finally {
        release();
      }
    },
  };
}
