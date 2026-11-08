/**
 * Runs `task` once per key at a time. Callers that arrive while it is running get the same result,
 * so work with side effects (such as creating and registering a device identity) is never done twice at once.
 */
export function singleFlight<T>(): (key: string, task: () => Promise<T>) => Promise<T> {
  const running = new Map<string, Promise<T>>();
  return (key, task) => {
    const existing = running.get(key);
    if (existing) return existing;
    const p = task().finally(() => { running.delete(key); });
    running.set(key, p);
    return p;
  };
}
