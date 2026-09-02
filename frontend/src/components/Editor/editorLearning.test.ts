import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTutorialDocument, convertLatexSnippetToTypst, explainCompileDiagnostic } from './editorLearning.ts'

test('latex converter maps common structure to typst', () => {
  const converted = convertLatexSnippetToTypst('\\section{Intro}\\n\\\\textbf{Bold} and \\\\cite{doe2025}')
  assert.match(converted, /= Intro/)
  assert.match(converted, /\*Bold\*/)
  assert.match(converted, /@doe2025/)
})

test('tutorial document contains the walkthrough title', () => {
  assert.match(buildTutorialDocument(), /= Typst Walkthrough/)
})

test('compile explanation explains missing references plainly', () => {
  const explanation = explainCompileDiagnostic({
    level: 'error',
    message: 'unknown variable: fig_setup',
    filePath: 'main.typ',
    line: 12,
    column: 4,
    raw: 'unknown variable: fig_setup',
  })
  assert.match(explanation, /cannot find|Check/i)
})
