import type { CompileDiagnostic } from '../../types'

export type EditorSignatureHint = {
  label: string
  summary: string
  signature?: string
  parameters?: string[]
  activeParameter: number | null
}

export type TutorialStep = {
  id: string
  title: string
  explanation: string
  snippet: string
}

export const TYPST_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'heading',
    title: 'Structure With Headings',
    explanation: 'Start with a heading so the document has a clear title and outline.',
    snippet: '= My First Typst Project\n\nThis paragraph is regular body text.\n',
  },
  {
    id: 'formatting',
    title: 'Inline Formatting',
    explanation: 'Use stars for emphasis and backticks for inline code or literal content.',
    snippet: 'You can write *emphasis*, _strong emphasis_, and `inline code`.\n',
  },
  {
    id: 'figure',
    title: 'Figures And Labels',
    explanation: 'Wrap images in `figure()` and attach a label so the document can reference them later.',
    snippet: '#figure(\n  image(\"figures/example.png\", width: 70%),\n  caption: [Experiment setup],\n) <fig:setup>\n',
  },
  {
    id: 'reference',
    title: 'References',
    explanation: 'Use `ref()` to point to labels that already exist in the document.',
    snippet: 'As shown in @fig:setup, the pipeline stays reproducible.\n',
  },
  {
    id: 'citations',
    title: 'Citations',
    explanation: 'Load a bibliography file once, then cite entries by key.',
    snippet: '#bibliography(\"references.bib\")\n\nRecent work supports this claim @doe2025.\n',
  },
]

export function buildTutorialDocument(): string {
  return [
    '= Typst Walkthrough',
    '',
    'This guided document teaches the most common building blocks used in Typst projects.',
    '',
    ...TYPST_TUTORIAL_STEPS.flatMap((step, index) => [
      `== Step ${index + 1}: ${step.title}`,
      step.explanation,
      '',
      step.snippet.trimEnd(),
      '',
    ]),
    '== Next',
    'Replace the placeholders with your real content and keep compiling as you go.',
    '',
  ].join('\n')
}

export function convertLatexSnippetToTypst(source: string): string {
  let output = source.trim()

  output = output
    .replace(/\\section\{([^}]+)\}/g, '= $1')
    .replace(/\\subsection\{([^}]+)\}/g, '== $1')
    .replace(/\\subsubsection\{([^}]+)\}/g, '=== $1')
    .replace(/\\textbf\{([^}]+)\}/g, '*$1*')
    .replace(/\\emph\{([^}]+)\}/g, '_$1_')
    .replace(/\\cite\{([^}]+)\}/g, '@$1')
    .replace(/\\ref\{([^}]+)\}/g, '@$1')
    .replace(/\\label\{([^}]+)\}/g, '<$1>')
    .replace(/\\item\s+/g, '- ')

  output = output.replace(/\\begin\{equation\*?\}([\s\S]*?)\\end\{equation\*?\}/g, (_, body: string) => {
    const compact = body.trim().replace(/\s+/g, ' ')
    return `$ ${compact} $`
  })

  output = output.replace(/\\begin\{itemize\}([\s\S]*?)\\end\{itemize\}/g, (_, body: string) => {
    return body
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => line.startsWith('- ') ? line : line.replace(/^\\item\s*/, '- '))
      .join('\n')
  })

  output = output.replace(/\\begin\{tabular\}\{([^}]+)\}([\s\S]*?)\\end\{tabular\}/g, (_, columns: string, body: string) => {
    const columnCount = columns.replace(/[^lcr]/g, '').length || 1
    const rows = body
      .split('\\\\')
      .map((row: string) => row.replace(/\\hline/g, '').trim())
      .filter(Boolean)
      .map((row: string) => row.split('&').map((cell) => `[${cell.trim()}]`).join(', '))

    return `#table(\n  columns: ${columnCount},\n  ${rows.join(',\n  ')}\n)`
  })

  return output
    .replace(/\\begin\{document\}|\\end\{document\}|\\maketitle/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function explainCompileDiagnostic(diagnostic: CompileDiagnostic): string {
  const message = diagnostic.message.toLowerCase()

  if (message.includes('unknown variable') || message.includes('unknown identifier')) {
    return 'Typst cannot find a name you referenced. Check for a typo, a missing import, or a label/citation key that was never defined.'
  }

  if (message.includes('expected') && (message.includes(']') || message.includes(')') || message.includes('}'))) {
    return 'This usually means a delimiter is unbalanced. Look just before the reported location for a missing closing bracket, parenthesis, or brace.'
  }

  if (message.includes('unexpected')) {
    return 'The parser hit syntax it did not expect. The real mistake is often a line or two earlier where punctuation, commas, or block markers stopped matching.'
  }

  if (message.includes('cannot join') || message.includes('type')) {
    return 'Two values are being combined in a way Typst does not allow. Check whether a function expects content, text, a number, or a label instead.'
  }

  if (message.includes('failed to resolve coordinate')) {
    return 'A drawing or plotting function could not interpret one of its coordinates. Check that coordinate arguments are written in code mode, not math or markup mode, and use a supported coordinate shape such as numeric pairs or named anchors.'
  }

  if (message.includes('file') && message.includes('not found')) {
    return 'A referenced asset is missing from the project workspace. Re-check the path, filename casing, and whether the file exists in this project.'
  }

  if (message.includes('cite') || message.includes('bibliograph')) {
    return 'The citation pipeline is incomplete. Make sure the bibliography file is loaded and that the cited key exists in that file.'
  }

  return diagnostic.level === 'warning'
    ? 'This warning indicates something unusual but not fatal. Review the surrounding markup to confirm the result still matches your intent.'
    : 'The compiler found a blocking problem in this area. Inspect the nearby syntax, imports, labels, and asset paths first.'
}
