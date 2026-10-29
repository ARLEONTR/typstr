import test from 'node:test'
import assert from 'node:assert/strict'
import { findPreviewPage, locateClickInSources, previewPageText, previewPhrasesAt } from './typstPreviewSync.ts'

const main = { id: 'main', path: 'main.typ', text: '= Giriş\n\nBu rapor *önemli* bir\nçalışmayı anlatır.\n\n#include "bolum.typ"\n' }
const chapter = { id: 'bolum', path: 'bolum.typ', text: '== Bölüm\n\nBu bölüm @tab:t tablosuna atıf yapar ve sonuçları özetler.\n' }

test('a click maps to the clicked letter, across markup and line breaks', () => {
  const run = 'Bu rapor önemli bir çalışmayı anlatır.'
  const location = locateClickInSources(run, run.indexOf('çalışmayı') + 3, [chapter, main])
  assert.deepEqual(location, { fileId: 'main', line: 4, column: 4 })
})

test('a click in an included file finds that file', () => {
  const run = 'tablosuna atıf yapar ve sonuçları özetler.'
  const location = locateClickInSources(run, run.indexOf('sonuçları'), [main, chapter])
  assert.deepEqual(location, { fileId: 'bolum', line: 3, column: chapter.text.split('\n')[2].indexOf('sonuçları') + 1 })
})

test('cursor phrases skip references, labels and function calls', () => {
  const phrases = previewPhrasesAt(chapter.text, 3, 40)
  assert.ok(phrases.length > 0)
  for (const phrase of phrases) assert.doesNotMatch(phrase, /@|tab:t/)
  assert.ok(phrases[0].includes('yapar'))
})

test('the preview page holding a phrase is found, nearest first', () => {
  const page = (text: string) => `<svg><foreignObject x="0" y="0" width="1" height="1"><h5:div class="tsel" style="font-size: 10px">${text}</h5:div></foreignObject></svg>`
  const texts = [page('Giriş metni'), page('atıf yapar ve sonuçları'), page('atıf yapar ve sonuçları')].map(previewPageText)
  assert.deepEqual(findPreviewPage(texts, ['yok', 'atıf yapar'], 2), { page: 2, phrase: 'atıf yapar' })
  assert.deepEqual(findPreviewPage(texts, ['atıf yapar'], 0), { page: 1, phrase: 'atıf yapar' })
  assert.equal(findPreviewPage(texts, ['hiç yok'], 0), null)
})
