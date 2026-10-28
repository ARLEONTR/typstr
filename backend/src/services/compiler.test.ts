import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { compileLatexProjectToPdf, parseCompileDiagnostics, texProcessEnv } from './compiler.js'

test('LaTeX compiler skips final pass when first pass is clean', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'typstr-compiler-test-'))
  const fakeBinDir = path.join(tempRoot, 'bin')
  const argsLogPath = path.join(tempRoot, 'args.log')
  const previousPath = process.env.PATH
  const previousArgsLog = process.env.TYPSTR_FAKE_LATEX_ARGS_LOG

  try {
    mkdirSync(fakeBinDir, { recursive: true })
    const fakePdflatexPath = path.join(fakeBinDir, 'pdflatex')
    writeFileSync(fakePdflatexPath, [
      '#!/bin/sh',
      `printf "%s\\n" "$*" >> "${argsLogPath}"`,
      'printf "aux" > main.aux',
      'printf "%s\\n" "%PDF-1.4" > main.pdf',
      'echo "fake pdflatex clean"',
    ].join('\n'))
    chmodSync(fakePdflatexPath, 0o755)

    process.env.PATH = `${fakeBinDir}${path.delimiter}${previousPath ?? ''}`
    process.env.TYPSTR_FAKE_LATEX_ARGS_LOG = argsLogPath

    const result = await compileLatexProjectToPdf({
      entryPath: 'main.tex',
      files: [{ path: 'main.tex', content: '\\documentclass{article}\\begin{document}Hello\\end{document}' }],
      engine: 'pdflatex',
    })

    const argsLines = readFileSync(argsLogPath, 'utf8').trim().split('\n')
    assert.equal(result.engine, 'pdflatex')
    assert.ok(result.pdf.length > 0)
    assert.equal(argsLines.length, 1)
  } finally {
    process.env.PATH = previousPath
    if (previousArgsLog === undefined) {
      delete process.env.TYPSTR_FAKE_LATEX_ARGS_LOG
    } else {
      process.env.TYPSTR_FAKE_LATEX_ARGS_LOG = previousArgsLog
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('LaTeX compiler runs nested entry files from their containing directory', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'typstr-compiler-test-'))
  const fakeBinDir = path.join(tempRoot, 'bin')
  const cwdLogPath = path.join(tempRoot, 'cwd.log')
  const previousPath = process.env.PATH
  const previousCwdLog = process.env.TYPSTR_FAKE_LATEX_CWD_LOG

  try {
    mkdirSync(fakeBinDir, { recursive: true })
    const fakePdflatexPath = path.join(fakeBinDir, 'pdflatex')
    writeFileSync(fakePdflatexPath, [
      '#!/bin/sh',
      `pwd >> "${cwdLogPath}"`,
      'if [ ! -f "main.tex" ]; then echo "missing main.tex"; exit 1; fi',
      'printf "aux" > main.aux',
      'printf "%s\\n" "%PDF-1.4" > main.pdf',
      'echo "fake pdflatex ok"',
    ].join('\n'))
    chmodSync(fakePdflatexPath, 0o755)

    process.env.PATH = `${fakeBinDir}${path.delimiter}${previousPath ?? ''}`
    process.env.TYPSTR_FAKE_LATEX_CWD_LOG = cwdLogPath

    const result = await compileLatexProjectToPdf({
      entryPath: 'imported/main.tex',
      files: [{ path: 'imported/main.tex', content: '\\documentclass{article}\\begin{document}Hello\\end{document}' }],
      engine: 'pdflatex',
    })

    const cwdLines = readFileSync(cwdLogPath, 'utf8').trim().split('\n')
    assert.equal(result.engine, 'pdflatex')
    assert.ok(result.pdf.length > 0)
    assert.equal(path.basename(cwdLines[0]), 'imported')
  } finally {
    process.env.PATH = previousPath
    if (previousCwdLog === undefined) {
      delete process.env.TYPSTR_FAKE_LATEX_CWD_LOG
    } else {
      process.env.TYPSTR_FAKE_LATEX_CWD_LOG = previousCwdLog
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('LaTeX compiler keeps generated PDF when engine reports errors', async () => {
  const tempRoot = mkdtempSync(path.join(tmpdir(), 'typstr-compiler-test-'))
  const fakeBinDir = path.join(tempRoot, 'bin')
  const argsLogPath = path.join(tempRoot, 'args.log')
  const previousPath = process.env.PATH
  const previousArgsLog = process.env.TYPSTR_FAKE_LATEX_ARGS_LOG

  try {
    mkdirSync(fakeBinDir, { recursive: true })
    const fakePdflatexPath = path.join(fakeBinDir, 'pdflatex')
    writeFileSync(fakePdflatexPath, [
      '#!/bin/sh',
      `printf "%s\\n" "$*" >> "${argsLogPath}"`,
      'printf "aux" > main.aux',
      'printf "%s\\n" "%PDF-1.4" > main.pdf',
      'echo "simulated recoverable latex error"',
      'exit 1',
    ].join('\n'))
    chmodSync(fakePdflatexPath, 0o755)

    process.env.PATH = `${fakeBinDir}${path.delimiter}${previousPath ?? ''}`
    process.env.TYPSTR_FAKE_LATEX_ARGS_LOG = argsLogPath

    const result = await compileLatexProjectToPdf({
      entryPath: 'main.tex',
      files: [{ path: 'main.tex', content: '\\documentclass{article}\\begin{document}Hello\\end{document}' }],
      engine: 'pdflatex',
    })

    const argsLog = readFileSync(argsLogPath, 'utf8')
    assert.equal(result.engine, 'pdflatex')
    assert.ok(result.pdf.length > 0)
    assert.match(result.log, /simulated recoverable latex error/)
    assert.doesNotMatch(argsLog, /halt-on-error/)
    assert.match(argsLog, /interaction=nonstopmode/)
  } finally {
    process.env.PATH = previousPath
    if (previousArgsLog === undefined) {
      delete process.env.TYPSTR_FAKE_LATEX_ARGS_LOG
    } else {
      process.env.TYPSTR_FAKE_LATEX_ARGS_LOG = previousArgsLog
    }
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('compiler diagnostics parse LaTeX file-line errors', () => {
  const diagnostics = parseCompileDiagnostics([
    'This is pdfTeX, Version 3.141592653',
    '! Undefined control sequence.',
    'main.tex:7: Undefined control sequence.',
    'l.7 \\\\unknown',
  ].join('\n'), 'main.tex')

  assert.equal(diagnostics.length, 1)
  assert.equal(diagnostics[0].level, 'error')
  assert.equal(diagnostics[0].filePath, 'main.tex')
  assert.equal(diagnostics[0].line, 7)
})

test('TeX tools get no backend secrets and paranoid file access', () => {
  const previousSecret = process.env.SESSION_SECRET
  process.env.SESSION_SECRET = 'do-not-leak'
  try {
    const texEnv = texProcessEnv()
    assert.equal(texEnv.SESSION_SECRET, undefined)
    assert.equal(texEnv.openin_any, 'p')
    assert.equal(texEnv.openout_any, 'p')
    assert.equal(texEnv.PATH, process.env.PATH)
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET
    else process.env.SESSION_SECRET = previousSecret
  }
})
