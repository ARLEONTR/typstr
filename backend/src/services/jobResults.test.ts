import test from 'node:test'
import assert from 'node:assert/strict'
import { INLINE_RESULT_MAX_BYTES, STORED_RESULT_TTL_SECONDS, packJobResult, unpackJobResult, type JobResultStore } from './jobResults.js'

function memoryStore() {
  const values = new Map<string, string>()
  const ttls = new Map<string, number>()
  const store: JobResultStore = {
    async put(key, value, ttlSeconds) {
      values.set(key, value)
      ttls.set(key, ttlSeconds)
    },
    async take(key) {
      const value = values.get(key) ?? null
      values.delete(key)
      return value
    },
  }
  return { store, values, ttls }
}

test('small results stay inline', async () => {
  const { store, values } = memoryStore()
  const result = { saved: true }
  const packed = await packJobResult(store, result)
  assert.deepEqual(packed, result)
  assert.equal(values.size, 0)
  assert.deepEqual(await unpackJobResult(store, packed), result)
})

test('undefined results stay undefined', async () => {
  const { store } = memoryStore()
  assert.equal(await packJobResult(store, undefined), undefined)
  assert.equal(await unpackJobResult(store, undefined), undefined)
})

test('large results are stored once, with an expiry, and read back whole', async () => {
  const { store, values, ttls } = memoryStore()
  const result = { format: 'pdf', pdfBase64: 'A'.repeat(INLINE_RESULT_MAX_BYTES * 4), diagnostics: [] }
  const packed = await packJobResult(store, result)

  assert.ok(JSON.stringify(packed).length < 200, 'the return value handed to BullMQ is small')
  assert.equal(values.size, 1)
  assert.equal([...ttls.values()][0], STORED_RESULT_TTL_SECONDS)

  assert.deepEqual(await unpackJobResult(store, packed), result)
  assert.equal(values.size, 0, 'reading the result deletes it')
  await assert.rejects(unpackJobResult(store, packed), /expired/)
})

test('only references to stored results are looked up', async () => {
  const { store } = memoryStore()
  const lookalike = { storedResultKey: 'session:abc' }
  assert.deepEqual(await unpackJobResult(store, lookalike), lookalike)
})
