/** Test helper: a promise with external resolve/reject. */
export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}

/** @returns a new deferred. */
export function deferred<T>(): Deferred<T> {
  let resolve: (v: T) => void = () => undefined;
  let reject: (e: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Flushes pending microtasks. */
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
