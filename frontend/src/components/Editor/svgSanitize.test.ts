import test from 'node:test'
import assert from 'node:assert/strict'
import { isSafePreviewHref, sanitizePreviewSvg } from './svgSanitize.ts'

test('script links from typst are neutralised', () => {
  const svg = '<svg><a transform="matrix(1 0 0 1 0 0)" href="javascript:alert(1)" xlink:href="javascript:alert(1)"><path d="M0 0"/></a></svg>'
  const clean = sanitizePreviewSvg(svg)
  assert.doesNotMatch(clean, /javascript/i)
  assert.match(clean, /<path d="M0 0"\/>/)
})

test('obfuscated schemes are caught', () => {
  for (const href of ['java\tscript:alert(1)', ' JAVASCRIPT:alert(1)', '&#106;avascript:alert(1)', 'javascript&colon;alert(1)', 'vbscript:x', 'data:text/html,<script>']) {
    assert.equal(isSafePreviewHref(href), false, href)
  }
})

test('ordinary links, glyph references and embedded images survive', () => {
  for (const href of ['https://typst.app', 'mailto:a@b.c', '#glyph-1', 'figures/a.png', 'data:image/png;base64,AAAA']) {
    assert.equal(isSafePreviewHref(href), true, href)
  }
  const svg = '<svg><use xlink:href="#g1"/><image href="data:image/png;base64,AAAA"/><a href="https://typst.app">x</a></svg>'
  assert.equal(sanitizePreviewSvg(svg), svg)
})

test('scripts, foreign objects and event handlers are removed', () => {
  const svg = '<svg onload="steal()"><script>steal()</script><foreignObject><div>x</div></foreignObject><g onclick="a()" onmouseover=\'b()\' class="t"></g></svg>'
  assert.equal(sanitizePreviewSvg(svg), '<svg><g class="t"></g></svg>')
})
