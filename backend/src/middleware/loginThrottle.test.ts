import test from 'node:test'
import assert from 'node:assert/strict'
import { clearLoginFailures, loginRetryAfterSeconds, recordLoginFailure, sweepLoginFailures } from './loginThrottle.js'

test('an account is locked after ten failures from any addresses', () => {
  const now = 1_000_000
  for (let index = 0; index < 9; index += 1) recordLoginFailure('Alice', `198.51.100.${index}`, now)
  assert.equal(loginRetryAfterSeconds('alice', '203.0.113.1', now), 0)
  recordLoginFailure('alice ', '198.51.100.99', now)
  assert.equal(loginRetryAfterSeconds('ALICE', '203.0.113.1', now), 900)
  assert.equal(loginRetryAfterSeconds('alice', '203.0.113.1', now + 15 * 60_000), 0)
  clearLoginFailures('alice')
  assert.equal(loginRetryAfterSeconds('alice', '203.0.113.1', now), 0)
})

test('an address is locked after twenty failures across accounts', () => {
  const now = 2_000_000
  for (let index = 0; index < 20; index += 1) recordLoginFailure(`user${index}`, '192.0.2.7', now)
  assert.ok(loginRetryAfterSeconds('someone-else', '192.0.2.7', now) > 0)
  assert.equal(loginRetryAfterSeconds('someone-else', '192.0.2.8', now), 0)
  sweepLoginFailures(now + 15 * 60_000)
  assert.equal(loginRetryAfterSeconds('someone-else', '192.0.2.7', now + 15 * 60_000), 0)
})
