import test from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeFontFile, TYPST_ASSETS_VERSION, TYPST_FONT_FILES, typstFontSources } from './typstFontAssets.ts'

const bytes = (head: number[]) => new Uint8Array([...head, ...new Array(16).fill(0)])

test('font files are recognised by their first bytes', () => {
  assert.ok(looksLikeFontFile(bytes([0x4f, 0x54, 0x54, 0x4f])))        // OTTO
  assert.ok(looksLikeFontFile(bytes([0x00, 0x01, 0x00, 0x00])))        // TrueType
  assert.ok(looksLikeFontFile(bytes([0x74, 0x74, 0x63, 0x66])))        // ttcf
  assert.ok(!looksLikeFontFile(new TextEncoder().encode('<!doctype html><html>')))
  assert.ok(!looksLikeFontFile(new Uint8Array([0x4f, 0x54])))
})

test('each font is served by typstr first and the CDN second', () => {
  const sources = typstFontSources()
  assert.equal(sources.length, TYPST_FONT_FILES.length)
  for (const { local, cdn } of sources) {
    assert.match(local, new RegExp(`^/assets/typst-fonts/${TYPST_ASSETS_VERSION}/[A-Za-z0-9-]+\\.(otf|ttf)$`))
    assert.match(cdn, /^https:\/\/cdn\.jsdelivr\.net\/gh\/typst\/typst-assets@/)
  }
})
