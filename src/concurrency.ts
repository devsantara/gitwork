/**
 * Returns a `run` function that starts tasks in the order given, with at most
 * `limit` of them unfinished at once.
 */
export function limitConcurrency(
  limit: number,
): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];

  return async (task) => {
    if (active < limit) active++;
    // A finishing task hands its slot straight to the next waiter, so a caller
    // arriving in between can never take it and push past the limit.
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
