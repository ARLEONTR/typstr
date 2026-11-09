import { randomUUID } from 'node:crypto'

// BullMQ copies a job's return value into the job hash and into the
// "completed" entry of the events stream. Compile and export results hold whole
// documents (a PDF in base64 is megabytes), and the capped stream still kept
// enough of them to fill Redis, which also holds the login sessions, so nobody
// could log in. Large results therefore go into a key of their own: the waiter
// reads and deletes it, and it expires if nobody does.
export const INLINE_RESULT_MAX_BYTES = 32 * 1024
export const STORED_RESULT_TTL_SECONDS = 5 * 60
const STORED_RESULT_KEY_PREFIX = 'typstr:job-result:'

export interface JobResultStore {
  put(key: string, value: string, ttlSeconds: number): Promise<unknown>
  /** Returns the value and deletes it, or null if it does not exist. */
  take(key: string): Promise<string | null>
}

type StoredResultRef = { storedResultKey: string }

/** Returns what the worker should hand to BullMQ as the job's return value. */
export async function packJobResult(store: JobResultStore, result: unknown): Promise<unknown> {
  const json = JSON.stringify(result)
  if (json === undefined || Buffer.byteLength(json) <= INLINE_RESULT_MAX_BYTES) {
    return result
  }

  const key = `${STORED_RESULT_KEY_PREFIX}${randomUUID()}`
  await store.put(key, json, STORED_RESULT_TTL_SECONDS)
  const ref: StoredResultRef = { storedResultKey: key }
  return ref
}

/** Turns a job's return value back into the result the job produced. */
export async function unpackJobResult<T>(store: JobResultStore, result: unknown): Promise<T> {
  if (!isStoredResultRef(result)) {
    return result as T
  }

  const json = await store.take(result.storedResultKey)
  if (json === null) {
    throw new Error('The job result expired before it was read')
  }
  return JSON.parse(json) as T
}

function isStoredResultRef(value: unknown): value is StoredResultRef {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 1) {
    return false
  }
  const key = (value as { storedResultKey?: unknown }).storedResultKey
  return typeof key === 'string' && key.startsWith(STORED_RESULT_KEY_PREFIX)
}
