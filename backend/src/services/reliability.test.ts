import test from 'node:test'
import assert from 'node:assert/strict'
import { getCompileWorkerMetrics } from './reliability.js'

test('compile worker metrics expose pool state', () => {
  const metrics = getCompileWorkerMetrics()
  assert.ok(metrics.concurrency >= 1)
  assert.ok(metrics.queued >= 0)
  assert.ok(metrics.running >= 0)
  assert.ok(metrics.cancellableSessions >= 0)
})
