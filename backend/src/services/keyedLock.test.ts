import test from 'node:test'
import assert from 'node:assert/strict'
import { withKeyedLock } from './keyedLock.js'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('runs tasks with the same key one after another, in order', async () => {
  const events: string[] = []
  const task = (name: string, ms: number) => withKeyedLock('file-1', async () => {
    events.push(`${name} start`)
    await pause(ms)
    events.push(`${name} end`)
    return name
  })

  const results = await Promise.all([task('a', 20), task('b', 1), task('c', 5)])
  assert.deepEqual(results, ['a', 'b', 'c'])
  assert.deepEqual(events, ['a start', 'a end', 'b start', 'b end', 'c start', 'c end'])
})

test('a failed task does not block the next one, and other keys run alongside', async () => {
  const failing = withKeyedLock('file-2', async () => {
    await pause(10)
    throw new Error('boom')
  })
  const next = withKeyedLock('file-2', async () => 'next')
  let otherKeyFinished = false
  const other = withKeyedLock('file-3', async () => {
    otherKeyFinished = true
  })

  await other
  assert.equal(otherKeyFinished, true)
  await assert.rejects(failing, /boom/)
  assert.equal(await next, 'next')
})
