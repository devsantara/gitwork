import { describe, expect, test } from 'vite-plus/test';

import { limitConcurrency } from '#/concurrency.js';

/** A task the test finishes by hand, so it controls the order things happen in. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('limitConcurrency', () => {
  test('runs at most the limit at once, starting the next as one finishes', async () => {
    const run = limitConcurrency(2);
    const tasks = [0, 1, 2, 3].map(() => deferred<void>());
    const started: number[] = [];

    const results = tasks.map((task, i) =>
      run(() => {
        started.push(i);
        return task.promise;
      }),
    );
    await tick();
    expect(started).toEqual([0, 1]);

    tasks[1]!.resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);

    tasks[0]!.resolve();
    tasks[2]!.resolve();
    tasks[3]!.resolve();
    await Promise.all(results);
    expect(started).toEqual([0, 1, 2, 3]);
  });

  test('a task started just as another finishes still waits its turn', async () => {
    const run = limitConcurrency(1);
    const first = deferred<void>();
    let running = 0;
    let most = 0;
    const track = async (work: Promise<void>) => {
      running++;
      most = Math.max(most, running);
      await work;
      running--;
    };

    const a = run(() => track(first.promise));
    const b = run(() => track(Promise.resolve()));
    first.resolve();
    await a;
    const c = run(() => track(Promise.resolve()));
    await Promise.all([b, c]);

    expect(most).toBe(1);
  });

  test('passes on each result, and a failure frees its slot', async () => {
    const run = limitConcurrency(1);

    const failing = run(() => Promise.reject(new Error('boom')));
    const passing = run(() => Promise.resolve(42));

    await expect(failing).rejects.toThrow('boom');
    await expect(passing).resolves.toBe(42);
  });
});
