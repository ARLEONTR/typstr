import test from 'node:test'
import assert from 'node:assert/strict'
import { collectDroppedFiles, runWithConcurrency } from './droppedFiles.ts'

type FakeEntry = { name: string; isFile: boolean; isDirectory: boolean; file?: (ok: (file: File) => void) => void; createReader?: () => { readEntries: (ok: (entries: FakeEntry[]) => void) => void } }

function fileEntry(name: string): FakeEntry {
  return { name, isFile: true, isDirectory: false, file: (ok) => ok(new File(['x'], name)) }
}

function dirEntry(name: string, children: FakeEntry[], batchSize = 2): FakeEntry {
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      let offset = 0
      return { readEntries: (ok) => { const batch = children.slice(offset, offset + batchSize); offset += batchSize; ok(batch) } }
    },
  }
}

function dataTransferOf(entries: FakeEntry[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((entry) => ({ kind: 'file', webkitGetAsEntry: () => entry })),
    files,
  } as unknown as DataTransfer
}

test('a dropped folder is walked recursively, reading every batch', async () => {
  const drop = dataTransferOf([
    dirEntry('thesis', [
      fileEntry('main.typ'),
      fileEntry('.DS_Store'),
      dirEntry('chapters', [fileEntry('a.typ'), fileEntry('b.typ'), fileEntry('c.typ')]),
      dirEntry('empty', []),
      dirEntry('.git', [fileEntry('HEAD')]),
    ]),
    fileEntry('refs.bib'),
  ])
  const result = await collectDroppedFiles(drop)
  assert.deepEqual(result.folders, ['thesis', 'thesis/chapters', 'thesis/empty'])
  assert.deepEqual(
    result.files.map((item) => `${item.directory ?? ''}/${item.file.name}`).sort(),
    ['/refs.bib', 'thesis/chapters/a.typ', 'thesis/chapters/b.typ', 'thesis/chapters/c.typ', 'thesis/main.typ'],
  )
})

test('without entry support the plain file list is used', async () => {
  const file = new File(['x'], 'a.png')
  const result = await collectDroppedFiles({ items: [{ kind: 'file' }], files: [file] } as unknown as DataTransfer)
  assert.deepEqual(result, { files: [{ file, directory: null }], folders: [] })
})

test('runWithConcurrency keeps at most the limit in flight', async () => {
  let running = 0
  let peak = 0
  const done: number[] = []
  await runWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    done.push(item)
    running -= 1
  })
  assert.equal(peak, 3)
  assert.equal(done.length, 7)
})
