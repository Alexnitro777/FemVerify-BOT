import { AsyncLocalStorage } from 'node:async_hooks';

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}

export function logSettledFailures(scope: string, results: PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === 'rejected') console.error(`[${scope}]`, result.reason);
  }
}
const userLocks = new Map<string, Promise<unknown>>();
interface UserLockScope {
  active: boolean;
  children: Set<Promise<unknown>>;
}
const userLockContext = new AsyncLocalStorage<ReadonlyMap<string, UserLockScope>>();

export function runUserExclusive<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const held = userLockContext.getStore();
  const scope = held?.get(userId);
  if (scope?.active) {
    const child = Promise.resolve().then(task);
    scope.children.add(child);
    void child.then(
      () => { scope.children.delete(child); },
      () => { scope.children.delete(child); },
    );
    return child;
  }

  const previous = userLocks.get(userId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const nextScope: UserLockScope = { active: true, children: new Set() };
    const nextContext = new Map(held);
    nextContext.set(userId, nextScope);
    return userLockContext.run(nextContext, async () => {
      try {
        return await task();
      } finally {
        while (nextScope.children.size > 0) await Promise.allSettled([...nextScope.children]);
        nextScope.active = false;
      }
    });
  });
  const settled = current.then(
    () => { if (userLocks.get(userId) === settled) userLocks.delete(userId); },
    () => { if (userLocks.get(userId) === settled) userLocks.delete(userId); },
  );
  userLocks.set(userId, settled);
  return current;
}
