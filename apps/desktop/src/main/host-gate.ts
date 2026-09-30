/** A promise opened once the host is ready, or failed once it is given
 *  up on. Nobody need be waiting on it when it fails. */
export interface Gate {
  promise: Promise<void>;
  settled: boolean;
  open(): void;
  fail(err: Error): void;
}

export function newGate(): Gate {
  let open!: () => void;
  let fail!: (err: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  promise.catch(() => undefined);
  const gate: Gate = {
    promise,
    settled: false,
    open: () => {
      gate.settled = true;
      open();
    },
    fail: (err) => {
      gate.settled = true;
      fail(err);
    },
  };
  return gate;
}

export function within(promise: Promise<void>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
