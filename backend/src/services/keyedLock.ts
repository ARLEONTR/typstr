const lockTails = new Map<string, Promise<unknown>>()

/**
 * Runs `task` after every earlier task with the same key has settled, so
 * work on one file or project never overlaps. Works within one process,
 * which is how typstr runs (SERVER_ROLE all).
 */
export async function withKeyedLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = lockTails.get(key) ?? Promise.resolve()
  const run = previous.then(task, task)
  const tail = run.catch(() => undefined)
  lockTails.set(key, tail)
  try {
    return await run
  } finally {
    if (lockTails.get(key) === tail) {
      lockTails.delete(key)
    }
  }
}
