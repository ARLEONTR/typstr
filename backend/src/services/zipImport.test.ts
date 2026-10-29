import test from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { decodeProjectText, decodeZipFileName, isIgnoredZipPath, normalizeZipPath, openProjectZip, ZipImportError } from './zipImport.js'

async function zipOf(files: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

test('paths are normalised and unsafe paths are dropped', () => {
  assert.equal(normalizeZipPath('chapters\\intro.typ'), 'chapters/intro.typ')
  assert.equal(normalizeZipPath('/abs/main.typ'), 'abs/main.typ')
  assert.equal(normalizeZipPath('figures/'), 'figures')
  assert.equal(normalizeZipPath('../escape.typ'), null)
  assert.equal(normalizeZipPath('a/../../escape.typ'), null)
  assert.equal(normalizeZipPath('a/\u0000b'), null)
})

test('OS metadata, VCS folders and build by-products are skipped', () => {
  for (const name of ['.DS_Store', 'x/Thumbs.db', '__MACOSX/a', '._main.typ', '.git/HEAD', 'main.aux', 'main.synctex.gz', 'main.log']) {
    assert.equal(isIgnoredZipPath(name), true, name)
  }
  for (const name of ['main.typ', 'main.tex', 'refs.bib', 'main.bbl', 'figures/a.pdf']) {
    assert.equal(isIgnoredZipPath(name), false, name)
  }
})

test('non-UTF-8 names are read as the Turkish OEM code page', () => {
  assert.equal(decodeZipFileName(Buffer.from('şekil ığ.typ', 'utf8')), 'şekil ığ.typ')
  assert.equal(decodeZipFileName(Uint8Array.from([0x9f, 0x65, 0x6b, 0x69, 0x6c, 0x20, 0x8d, 0xa7])), 'şekil ığ')
})

test('legacy Turkish text files are decoded', () => {
  assert.equal(decodeProjectText(Buffer.from([0x41, 0xf0, 0x61, 0xe7])), 'Ağaç')
  assert.equal(decodeProjectText(Buffer.from('Ağaç', 'utf8')), 'Ağaç')
})

test('a single wrapping folder is removed and folders come before files', async () => {
  const entries = await openProjectZip(await zipOf({ 'proj/main.typ': 'x', 'proj/ch/a.typ': 'y', 'proj/.DS_Store': 'z', '__MACOSX/proj/._main.typ': 'z' }))
  assert.deepEqual(entries.map((entry) => [entry.path, entry.isDirectory]), [['ch', true], ['ch/a.typ', false], ['main.typ', false]])
  assert.equal((await entries[2].read()).toString(), 'x')
})

test('corrupt, empty and oversized archives are rejected', async () => {
  await assert.rejects(openProjectZip(Buffer.from('not a zip')), ZipImportError)
  await assert.rejects(openProjectZip(await zipOf({ '.DS_Store': 'x' })), /no project files/)
  const bomb = await openProjectZip(await zipOf({ 'main.typ': 'x', 'big.bin': Buffer.alloc(210 * 1024 * 1024) }))
  await assert.rejects(bomb.find((entry) => entry.path === 'big.bin')!.read(), (error: ZipImportError) => error.status === 413)
})
