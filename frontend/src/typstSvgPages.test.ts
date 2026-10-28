import test from 'node:test'
import assert from 'node:assert/strict'
import { splitTypstSvgIntoPages } from './typstSvgPages.ts'

const document = [
  '<svg style="overflow: visible;" class="typst-doc" viewBox="0 0 596.000 1684.000" width="596.000" height="1684.000" data-width="596.000" data-height="1684.000" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">',
  '<style type="text/css">.typst-doc > g { fill: none }</style>',
  '<defs class="glyph"><path id="g1" d="M0 0"/></defs>',
  '<defs class="clip-path"></defs>',
  '<g class="typst-page" transform="translate(0, 0)" data-page-width="596" data-page-height="842"><g><use xlink:href="#g1"/></g></g>',
  '<g class="typst-page" transform="translate(0, 842)" data-page-width="596" data-page-height="842"><g><use xlink:href="#g1"/><path d="M1 1"/></g></g>',
  '<script type="text/javascript">if (a < b) { x() }</script>',
  '</svg>',
].join('')

test('a whole-document SVG is split into one SVG per page', () => {
  const pages = splitTypstSvgIntoPages(document)
  assert.equal(pages.length, 2)
  for (const page of pages) {
    assert.match(page, /^<svg viewBox="0 0 596 842" width="596" height="842"/)
    assert.match(page, /class="typst-doc"/)
    assert.match(page, /<defs class="glyph"><path id="g1" d="M0 0"\/><\/defs>/)
    assert.match(page, /\.typst-doc > g/)
    assert.doesNotMatch(page, /<script/)
    assert.equal(page.match(/class="typst-page"/g)?.length, 1)
  }
  assert.match(pages[1], /<g transform="translate\(0, -842\)"><g class="typst-page" transform="translate\(0, 842\)"/)
  assert.match(pages[1], /<path d="M1 1"\/>/)
})

test('SVG without page groups is returned unchanged', () => {
  const svg = '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'
  assert.deepEqual(splitTypstSvgIntoPages(svg), [svg])
})
