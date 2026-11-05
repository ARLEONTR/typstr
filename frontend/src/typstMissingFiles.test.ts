import test from 'node:test'
import assert from 'node:assert/strict'
import { explainMissingFiles, isVirtualDirectory } from './typstMissingFiles.ts'

const files = new Map<string, Uint8Array>([['/main.typ', new Uint8Array()], ['chapters/intro.typ', new Uint8Array()]])

test('a folder of the workspace is recognised as one', () => {
  assert.ok(isVirtualDirectory(files, 'chapters'))
  assert.ok(isVirtualDirectory(files, 'chapters/'))
  assert.ok(!isVirtualDirectory(files, 'chapters/results.typ'))
  assert.ok(!isVirtualDirectory(files, 'chap'))
})

test('the "is a directory" error names the missing files', () => {
  const missing = ['ofdma_sub_topics/sonuclar/sonuclar.typ']
  assert.equal(
    explainMissingFiles('error: failed to load file (is a directory)', missing),
    'error: file not found in the project: ofdma_sub_topics/sonuclar/sonuclar.typ',
  )
  const error = new Error('[SourceDiagnostic { message: "failed to load file (is a directory)" }]')
  assert.equal(explainMissingFiles(error, missing), error)
  assert.match(error.message, /message: "file not found in the project: ofdma_sub_topics\/sonuclar\/sonuclar\.typ"/)
  assert.deepEqual(
    explainMissingFiles([{ message: 'failed to load file (is a directory)', severity: 'error' }], missing),
    [{ message: 'file not found in the project: ofdma_sub_topics/sonuclar/sonuclar.typ', severity: 'error' }],
  )
})

test('other errors and real folders are left alone', () => {
  assert.equal(explainMissingFiles('failed to load file (is a directory)', []), 'failed to load file (is a directory)')
  assert.equal(explainMissingFiles('unknown variable: x', ['a.typ']), 'unknown variable: x')
})
