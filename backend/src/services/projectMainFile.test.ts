import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseAutomaticMainFile } from './projectMainFile.js'

const files = [
  { id: 'chapter', name: 'chapter.typ', path: 'chapters/chapter.typ' },
  { id: 'latex-main', name: 'paper.tex', path: 'paper.tex' },
  { id: 'typst-main', name: 'main.typ', path: 'main.typ' },
]

test('automatic main file prefers a LaTeX documentclass entry', () => {
  const selected = chooseAutomaticMainFile(files, new Map([
    ['latex-main', '\\documentclass{article}\n\\begin{document}\n'],
    ['typst-main', '= Typst document\n'],
  ]))

  assert.equal(selected?.id, 'latex-main')
})

test('automatic main file chooses a strong Typst entry when no LaTeX documentclass exists', () => {
  const selected = chooseAutomaticMainFile(files, new Map([
    ['latex-main', '\\input{sections/intro}\n'],
    ['typst-main', '#show: document => document\n#include "chapters/chapter.typ"\n'],
    ['chapter', '= Chapter\n'],
  ]))

  assert.equal(selected?.id, 'typst-main')
})
