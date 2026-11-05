import test from 'node:test'
import assert from 'node:assert/strict'
import { TYPST_AUTO_COMPILE_MAX_DELAY_MS, TYPST_AUTO_COMPILE_MIN_DELAY_MS, typstAutoCompileDelayFor } from './compileDelay.ts'

test('short documents follow every keystroke', () => {
  assert.equal(typstAutoCompileDelayFor(null), TYPST_AUTO_COMPILE_MIN_DELAY_MS)
  assert.equal(typstAutoCompileDelayFor(undefined), TYPST_AUTO_COMPILE_MIN_DELAY_MS)
  assert.equal(typstAutoCompileDelayFor(40), TYPST_AUTO_COMPILE_MIN_DELAY_MS)
  assert.equal(typstAutoCompileDelayFor(150), TYPST_AUTO_COMPILE_MIN_DELAY_MS)
  assert.equal(typstAutoCompileDelayFor(Number.NaN), TYPST_AUTO_COMPILE_MIN_DELAY_MS)
})

test('slow documents wait for a pause that grows with the compile time', () => {
  assert.equal(typstAutoCompileDelayFor(500), 300)
  assert.equal(typstAutoCompileDelayFor(1500), 900)
  assert.ok(typstAutoCompileDelayFor(400) < typstAutoCompileDelayFor(800))
})

test('the pause is capped', () => {
  assert.equal(typstAutoCompileDelayFor(10_000), TYPST_AUTO_COMPILE_MAX_DELAY_MS)
})
