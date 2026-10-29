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

test('the text layer is kept as plain text for click-to-source', () => {
  const svg = '<svg><foreignObject x="0" y="-55.88" width="254.19" height="62.50" onload="x()"><h5:div class="tsel" style="font-size: 62px; background: url(javascript:x)">Bölüm &amp; <b onclick="x()">1</b> &lt;img&gt;</h5:div></foreignObject>'
    + '<foreignObject x="1" y="2" width="3" height="4"><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="javascript:x()"></iframe></div></foreignObject></svg>'
  assert.equal(
    sanitizePreviewSvg(svg),
    '<svg><foreignObject x="0" y="-55.88" width="254.19" height="62.50"><h5:div class="tsel" style="font-size: 62px">Bölüm &amp; 1 &lt;img&gt;</h5:div></foreignObject></svg>',
  )
})
