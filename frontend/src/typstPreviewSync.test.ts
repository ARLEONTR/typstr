import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPreviewIndex, buildSourceIndex, previewRuns, previewToSource, sourceToPreview } from './typstPreviewSync.ts'

const files = [
  { id: 'main', path: 'main.typ', text: '#import "lib.typ": *\n= Giriş\n\nBu rapor *önemli* bir çalışmayı anlatır. Sonuçlar aşağıdadır.\n\n#include "chapters/a.typ"\n#include "chapters/b.typ"\n\n#bibliography("refs.bib")\n' },
  // The same sentence in both chapters: only its occurrence tells them apart.
  { id: 'a', path: 'chapters/a.typ', text: '== Birinci\n\nSonuçlar aşağıdadır. Ölçümler @tab:t içinde.\n' },
  { id: 'b', path: 'chapters/b.typ', text: '== İkinci\n\nSonuçlar aşağıdadır. Yorumlar #emph[burada] yer alır.\n' },
]

const page = (...runs: string[]) => `<svg>${runs.map((run) => `<foreignObject x="0" y="0" width="1" height="1"><h5:div class="tsel" style="font-size: 10px">${run}</h5:div></foreignObject>`).join('')}</svg>`
const pages = [
  page('Giriş', 'Bu rapor önemli bir çalışmayı anlatır. Sonuçlar', 'aşağıdadır.'),
  page('1 Birinci', 'Sonuçlar aşağıdadır. Ölçümler Tablo 1 içinde.'),
  page('2 İkinci', 'Sonuçlar aşağıdadır. Yorumlar burada yer alır.'),
]

test('preview runs are read from the text layer', () => {
  assert.deepEqual(previewRuns(pages[1]), ['1 Birinci', 'Sonuçlar aşağıdadır. Ölçümler Tablo 1 içinde.'])
})

test('a click maps to the same occurrence, in the right sub-document', () => {
  const source = buildSourceIndex('main.typ', files)
  const preview = buildPreviewIndex(pages)
  const run = 'Sonuçlar aşağıdadır. Yorumlar burada yer alır.'
  assert.deepEqual(previewToSource(preview, { page: 2, run: 1, offset: run.indexOf('aşağı') + 2 }, source, files), { fileId: 'b', line: 3, column: 12 })
  assert.deepEqual(previewToSource(preview, { page: 1, run: 1, offset: 0 }, source, files), { fileId: 'a', line: 3, column: 1 })
  assert.deepEqual(previewToSource(preview, { page: 0, run: 1, offset: 9 }, source, files), { fileId: 'main', line: 4, column: 11 })
})

test('a cursor maps to the same occurrence on the right page', () => {
  const source = buildSourceIndex('main.typ', files)
  const preview = buildPreviewIndex(pages)
  assert.deepEqual(sourceToPreview(source, 'b', files[2].text, 3, 5, preview), { page: 2, run: 1 })
  assert.deepEqual(sourceToPreview(source, 'a', files[1].text, 3, 5, preview), { page: 1, run: 1 })
  assert.deepEqual(sourceToPreview(source, 'main', files[0].text, 4, 46, preview), { page: 0, run: 1 })
  // A heading line maps to the heading's run.
  assert.deepEqual(sourceToPreview(source, 'b', files[2].text, 1, 5, preview), { page: 2, run: 0 })
})
