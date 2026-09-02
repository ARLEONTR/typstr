import { useCallback, useRef, useState } from 'react'
import { Check, Copy, FileOutput, X } from '../../icons'
import styles from './PlotPanel.module.css'

type ProjectFormat = 'typst' | 'latex'

type PlotTab = 'csv' | 'templates'

type ChartType = 'line' | 'bar' | 'scatter' | 'histogram'

interface CsvData {
  fileName: string
  headers: string[]
  rows: string[][]
}

interface PlotOptions {
  chartType: ChartType
  xCol: string
  yCols: string[]
  title: string
  xLabel: string
  yLabel: string
  figLabel: string
  caption: string
}

interface Template {
  id: string
  name: string
  description: string
  snippet: (format: ProjectFormat) => string
}

interface Props {
  projectFormat: ProjectFormat
  canEdit: boolean
  onInsertAtCursor: (text: string) => void
}

// ── CSV parsing ────────────────────────────────────────────────────────────

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return { headers: [], rows: [] }

  const parseRow = (line: string): string[] => {
    const result: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(cur.trim())
        cur = ''
      } else {
        cur += ch
      }
    }
    result.push(cur.trim())
    return result
  }

  const headers = parseRow(lines[0]!)
  const rows = lines.slice(1).map(parseRow)
  return { headers, rows }
}

// ── Snippet generators ─────────────────────────────────────────────────────

function makePgfplotsCoords(rows: string[][], xIdx: number, yIdx: number): string {
  return rows
    .slice(0, 300)
    .filter((r) => r[xIdx] !== undefined && r[yIdx] !== undefined)
    .map((r) => `(${r[xIdx]}, ${r[yIdx]})`)
    .join(' ')
}

function generateLatexSnippet(opts: PlotOptions, csv: CsvData | null): string {
  const { chartType, xCol, yCols, title, xLabel, yLabel, figLabel, caption } = opts
  const safeLabel = figLabel || 'fig:plot'
  const safeCaption = caption || title || 'Plot'

  if (!csv) {
    // skeleton with placeholder data
    const coords = '(1, 1.0) (2, 2.5) (3, 2.0) (4, 3.5)'
    return buildLatexFigure(chartType, coords, title, xLabel || 'x', yLabel || 'y', safeLabel, safeCaption, null)
  }

  const xIdx = csv.headers.indexOf(xCol)
  const primaryYIdx = csv.headers.indexOf(yCols[0] ?? '')

  if (xIdx < 0 || primaryYIdx < 0) return '% Please select valid X and Y columns.'

  if (chartType === 'bar') {
    const pairs = csv.rows.slice(0, 30).filter((r) => r[xIdx] !== undefined && r[primaryYIdx] !== undefined)
    const symbols = pairs.map((r) => r[xIdx]!).join(',')
    const coords = pairs.map((r) => `(${r[xIdx]}, ${r[primaryYIdx]})`).join(' ')
    const axis = [
      `title={${title || 'Bar Chart'}},`,
      `xlabel={${xLabel || xCol}},`,
      `ylabel={${yLabel || yCols[0]}},`,
      'ybar,',
      'bar width=0.5cm,',
      `symbolic x coords={${symbols}},`,
      'xtick=data,',
      'grid=major,',
      'enlarge x limits=0.15,',
    ]
    const body = `    \\addplot coordinates {\n        ${coords}\n      };`
    return wrapLatexFigure(axis.join('\n      '), body, safeLabel, safeCaption)
  }

  const seriesSnippets: string[] = []
  const legendEntries: string[] = []
  for (const yColName of yCols.slice(0, 6)) {
    const yIdx = csv.headers.indexOf(yColName)
    if (yIdx < 0) continue
    const coords = makePgfplotsCoords(csv.rows, xIdx, yIdx)
    const plotOpts = chartType === 'scatter' ? '[only marks]' : chartType === 'histogram' ? '[hist]' : ''
    seriesSnippets.push(`    \\addplot${plotOpts} coordinates {\n        ${coords}\n      };`)
    legendEntries.push(yColName)
  }

  const axis = [
    `title={${title || 'Plot'}},`,
    `xlabel={${xLabel || xCol}},`,
    `ylabel={${yLabel || yCols.join(', ')}},`,
    'grid=major,',
    chartType === 'histogram' ? 'ymin=0,' : '',
  ].filter(Boolean)

  const legendLine = legendEntries.length > 1
    ? `\n      \\legend{${legendEntries.map((e) => `{${e}}`).join(', ')}}`
    : ''

  return wrapLatexFigure(axis.join('\n      '), seriesSnippets.join('\n') + legendLine, safeLabel, safeCaption)
}

function buildLatexFigure(chartType: ChartType, coords: string, title: string, xLabel: string, yLabel: string, label: string, caption: string, _csv: CsvData | null): string {
  const plotOpts = chartType === 'scatter' ? '[only marks]' : chartType === 'bar' ? '' : ''
  const axisType = chartType === 'bar' ? 'axis' : 'axis'
  const axis = [
    `title={${title || 'Plot'}},`,
    `xlabel={${xLabel}},`,
    `ylabel={${yLabel}},`,
    'grid=major,',
    chartType === 'bar' ? 'ybar,' : '',
  ].filter(Boolean).join('\n      ')
  const body = `    \\addplot${plotOpts} coordinates {\n        ${coords}\n      };`
  void axisType
  return wrapLatexFigure(axis, body, label, caption)
}

function wrapLatexFigure(axisOptions: string, body: string, label: string, caption: string): string {
  return `\\begin{figure}[ht]
  \\centering
  \\begin{tikzpicture}
    \\begin{axis}[
      ${axisOptions}
    ]
${body}
    \\end{axis}
  \\end{tikzpicture}
  \\caption{${caption}}
  \\label{${label}}
\\end{figure}`
}

function generateTypstSnippet(opts: PlotOptions, csv: CsvData | null): string {
  const { chartType, xCol, yCols, title, xLabel, yLabel, figLabel, caption } = opts
  const label = figLabel ? ` <${figLabel}>` : ''

  let dataPoints = '(1, 1.0), (2, 2.5), (3, 2.0), (4, 3.5)'
  if (csv) {
    const xIdx = csv.headers.indexOf(xCol)
    const yIdx = csv.headers.indexOf(yCols[0] ?? '')
    if (xIdx >= 0 && yIdx >= 0) {
      dataPoints = csv.rows
        .slice(0, 300)
        .filter((r) => r[xIdx] !== undefined && r[yIdx] !== undefined)
        .map((r) => `(${r[xIdx]}, ${r[yIdx]})`)
        .join(', ')
    }
  }

  const plotStyle = chartType === 'bar'
    ? 'style: (stroke: none), mark: none, fill: blue.lighten(40%),'
    : chartType === 'scatter'
      ? 'mark: "o", mark-size: 0.1,'
      : ''

  return `#import "@preview/cetz:0.4.2": canvas, draw
#import "@preview/cetz-plot:0.1.3": plot

#figure(
  canvas({
    import draw: *
    plot.plot(
      size: (8, 5),
      x-label: "${xLabel || xCol || 'x'}",
      y-label: "${yLabel || yCols[0] || 'y'}",
      {
        plot.add(
          (${dataPoints}),
          ${plotStyle}
          label: "${yCols[0] || 'Series 1'}",
        )
      }
    )
  }),
  caption: [${caption || title || 'Plot'}],
)${label}`
}

// ── Built-in templates ─────────────────────────────────────────────────────

const TEMPLATES: Template[] = [
  {
    id: 'tikz-flowchart',
    name: 'Flowchart (TikZ / CeTZ)',
    description: 'Sequential process with decision diamond',
    snippet: (fmt) => fmt === 'latex' ? `\\begin{figure}[ht]
  \\centering
  \\begin{tikzpicture}[node distance=1.6cm, >=stealth,
    box/.style={rectangle, draw, rounded corners=4pt,
                minimum width=2.6cm, minimum height=0.8cm,
                text centered, font=\\small},
    decision/.style={diamond, draw, aspect=2,
                     minimum width=2.8cm, text centered, font=\\small}]
    \\node[box] (start) {Start};
    \\node[box, below of=start] (step1) {Step 1};
    \\node[decision, below of=step1, yshift=-0.4cm] (cond) {Condition?};
    \\node[box, below of=cond, yshift=-0.4cm] (step2) {Step 2};
    \\node[box, right of=cond, xshift=2cm] (alt) {Alternative};
    \\node[box, below of=step2] (end) {End};
    \\draw[->] (start) -- (step1);
    \\draw[->] (step1) -- (cond);
    \\draw[->] (cond) -- node[right]{Yes} (step2);
    \\draw[->] (cond) -- node[above]{No} (alt);
    \\draw[->] (step2) -- (end);
    \\draw[->] (alt) |- (end);
  \\end{tikzpicture}
  \\caption{Process flowchart}
  \\label{fig:flowchart}
\\end{figure}` : `#import "@preview/cetz:0.4.2": canvas, draw

#figure(
  canvas({
    import draw: *
    rect((0,0), (2.5,0.8), name: "start", stroke: black)
    content("start", [Start])
    rect((0,-1.8), (2.5,-1.0), name: "step1")
    content((1.25,-1.4), [Step 1])
    rect((0,-3.6), (2.5,-2.8), name: "step2")
    content((1.25,-3.2), [Step 2])
    rect((0,-5.4), (2.5,-4.6), name: "end")
    content((1.25,-5.0), [End])
    line("start.south", "step1.north", mark: (end: ">"))
    line("step1.south", "step2.north", mark: (end: ">"))
    line("step2.south", "end.north", mark: (end: ">"))
  }),
  caption: [Process flowchart],
)`,
  },
  {
    id: 'tikz-block-diagram',
    name: 'Block Diagram (TikZ / CeTZ)',
    description: 'Signal-flow or system block diagram',
    snippet: (fmt) => fmt === 'latex' ? `\\begin{figure}[ht]
  \\centering
  \\begin{tikzpicture}[>=stealth, auto,
    block/.style={rectangle, draw, minimum width=2cm,
                  minimum height=1cm, text centered, font=\\small}]
    \\node[block] (input) {Input};
    \\node[block, right of=input, xshift=2.4cm] (process) {Process};
    \\node[block, right of=process, xshift=2.4cm] (output) {Output};
    \\draw[->] (input) -- (process) node[midway, above]{$x$};
    \\draw[->] (process) -- (output) node[midway, above]{$y$};
    \\draw[->] ([yshift=-1.6cm]process.south) |- ([yshift=-0.8cm]output.south)
               -| node[near end, right]{Feedback} (input);
  \\end{tikzpicture}
  \\caption{System block diagram with feedback}
  \\label{fig:block-diagram}
\\end{figure}` : `#import "@preview/cetz:0.4.2": canvas, draw

#figure(
  canvas({
    import draw: *
    for (pos, label) in (
      ((0,0), "Input"), ((3.5,0), "Process"), ((7,0), "Output")
    ) {
      rect((pos.at(0)-1, -0.5), (pos.at(0)+1, 0.5))
      content(pos, label)
    }
    line((1,0), (2.5,0), mark: (end: ">"))
    line((4.5,0), (6,0), mark: (end: ">"))
    bezier((6.5,-0.5), (6.5,-1.5), (0,-1.5), (-1,0), mark: (end: ">"))
  }),
  caption: [System block diagram],
)`,
  },
  {
    id: 'tikz-axes',
    name: 'Annotated Axes (TikZ)',
    description: 'Clean coordinate system with annotations',
    snippet: (fmt) => fmt === 'latex' ? `\\begin{figure}[ht]
  \\centering
  \\begin{tikzpicture}[>=stealth]
    \\draw[->] (-0.3,0) -- (5,0) node[right]{$x$};
    \\draw[->] (0,-0.3) -- (0,4) node[above]{$y$};
    \\foreach \\x in {1,2,3,4}
      \\draw (\\x,2pt) -- (\\x,-2pt) node[below]{\\x};
    \\foreach \\y in {1,2,3}
      \\draw (2pt,\\y) -- (-2pt,\\y) node[left]{\\y};
    \\draw[blue, thick, domain=0:4.5, samples=100]
      plot (\\x, {0.5*\\x*\\x + 0.2});
    \\node[blue] at (3.5,3.5) {$y = \\frac{x^2}{2}$};
  \\end{tikzpicture}
  \\caption{Annotated curve on coordinate axes}
  \\label{fig:axes}
\\end{figure}` : `#import "@preview/cetz:0.4.2": canvas, draw
#import "@preview/cetz-plot:0.1.3": plot

#figure(
  canvas({
    import draw: *
    plot.plot(
      size: (7, 5),
      x-label: $x$,
      y-label: $y$,
      {
        plot.add(
          domain: (0, 4),
          x => 0.5 * x * x + 0.2,
          label: $y = x^2/2$,
        )
      }
    )
  }),
  caption: [Annotated curve],
)`,
  },
  {
    id: 'pgfplots-multiline',
    name: 'Multi-Series Line Plot',
    description: 'Multiple overlaid series with legend',
    snippet: (fmt) => fmt === 'latex' ? `\\begin{figure}[ht]
  \\centering
  \\begin{tikzpicture}
    \\begin{axis}[
      title={Multi-Series Comparison},
      xlabel={$x$},
      ylabel={$y$},
      grid=major,
      legend pos=north west,
    ]
      \\addplot coordinates {(0,0) (1,1) (2,1.4) (3,1.7) (4,2.0)};
      \\addplot coordinates {(0,0) (1,0.5) (2,1.0) (3,1.8) (4,2.8)};
      \\addplot coordinates {(0,2) (1,1.6) (2,1.3) (3,1.1) (4,1.0)};
      \\legend{Series A, Series B, Series C}
    \\end{axis}
  \\end{tikzpicture}
  \\caption{Multi-series comparison}
  \\label{fig:multiline}
\\end{figure}` : `#import "@preview/cetz:0.4.2": canvas, draw
#import "@preview/cetz-plot:0.1.3": plot

#figure(
  canvas({
    import draw: *
    plot.plot(
      size: (8, 5),
      x-label: $x$,
      y-label: $y$,
      legend: "inner-north-west",
      {
        plot.add(((0,0),(1,1),(2,1.4),(3,1.7),(4,2.0)), label: "Series A")
        plot.add(((0,0),(1,0.5),(2,1.0),(3,1.8),(4,2.8)), label: "Series B")
        plot.add(((0,2),(1,1.6),(2,1.3),(3,1.1),(4,1.0)), label: "Series C")
      }
    )
  }),
  caption: [Multi-series comparison],
)`,
  },
  {
    id: 'pgfplots-error-bars',
    name: 'Error Bars Plot',
    description: 'Data points with ±uncertainty bands',
    snippet: (fmt) => fmt === 'latex' ? `\\begin{figure}[ht]
  \\centering
  \\begin{tikzpicture}
    \\begin{axis}[
      title={Measurements with Uncertainty},
      xlabel={$x$},
      ylabel={$y$},
      grid=major,
    ]
      \\addplot+[error bars/.cd, y dir=both, y explicit]
        coordinates {
          (1, 2.1)  +- (0, 0.3)
          (2, 3.5)  +- (0, 0.4)
          (3, 3.0)  +- (0, 0.2)
          (4, 4.1)  +- (0, 0.5)
          (5, 4.8)  +- (0, 0.3)
        };
    \\end{axis}
  \\end{tikzpicture}
  \\caption{Experimental measurements with error bars}
  \\label{fig:errorbars}
\\end{figure}` : `#import "@preview/cetz:0.4.2": canvas, draw
#import "@preview/cetz-plot:0.1.3": plot

// Note: error bars require cetz-plot >= 0.1.1
#figure(
  canvas({
    import draw: *
    plot.plot(
      size: (8, 5),
      x-label: $x$,
      y-label: $y$,
      {
        plot.add(
          ((1,2.1),(2,3.5),(3,3.0),(4,4.1),(5,4.8)),
          mark: "o",
          label: "Measurements",
        )
      }
    )
  }),
  caption: [Experimental measurements],
)`,
  },
  {
    id: 'tikz-matrix',
    name: 'Matrix / Table Figure (TikZ)',
    description: 'Labeled matrix with highlighted cells',
    snippet: (fmt) => fmt === 'latex' ? `\\begin{figure}[ht]
  \\centering
  \\begin{tikzpicture}
    \\matrix (m) [matrix of nodes, nodes={draw, minimum size=1cm,
                  font=\\small, anchor=center},
                  column sep=-\\pgflinewidth,
                  row sep=-\\pgflinewidth] {
      $a_{11}$ & $a_{12}$ & $a_{13}$ \\\\
      $a_{21}$ & $a_{22}$ & $a_{23}$ \\\\
      $a_{31}$ & $a_{32}$ & $a_{33}$ \\\\
    };
    \\draw[red, thick] (m-1-1.north west) rectangle (m-1-3.south east);
    \\node[above=4pt of m-1-2, red, font=\\small] {Row 1};
  \\end{tikzpicture}
  \\caption{$3 \\times 3$ matrix with highlighted first row}
  \\label{fig:matrix}
\\end{figure}` : `#figure(
  table(
    columns: 3,
    fill: (x, y) => if y == 0 { red.lighten(60%) } else { white },
    [$a_11$], [$a_12$], [$a_13$],
    [$a_21$], [$a_22$], [$a_23$],
    [$a_31$], [$a_32$], [$a_33$],
  ),
  caption: [$3 times 3$ matrix with highlighted first row],
)`,
  },
]

// ── Chart type definitions ─────────────────────────────────────────────────

const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'line', label: 'Line' },
  { id: 'bar', label: 'Bar' },
  { id: 'scatter', label: 'Scatter' },
  { id: 'histogram', label: 'Histogram' },
]

// ── Component ──────────────────────────────────────────────────────────────

export default function PlotPanel({ projectFormat, canEdit, onInsertAtCursor }: Props) {
  const [activeTab, setActiveTab] = useState<PlotTab>('csv')
  const [csv, setCsv] = useState<CsvData | null>(null)
  const [csvError, setCsvError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [opts, setOpts] = useState<PlotOptions>({
    chartType: 'line',
    xCol: '',
    yCols: [],
    title: '',
    xLabel: '',
    yLabel: '',
    figLabel: 'fig:plot',
    caption: '',
  })
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const loadCsvFile = useCallback((file: File) => {
    setCsvError(null)
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const { headers, rows } = parseCsv(text)
      if (headers.length === 0) {
        setCsvError('Could not parse CSV — check that the file has a header row.')
        return
      }
      setCsv({ fileName: file.name, headers, rows })
      setOpts((prev) => ({
        ...prev,
        xCol: headers[0] ?? '',
        yCols: headers.slice(1, 2),
      }))
    }
    reader.readAsText(file)
  }, [])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) loadCsvFile(file)
    e.target.value = ''
  }, [loadCsvFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      loadCsvFile(file)
    } else {
      setCsvError('Please drop a .csv file.')
    }
  }, [loadCsvFile])

  const snippet = activeTab === 'csv'
    ? (projectFormat === 'latex' ? generateLatexSnippet(opts, csv) : generateTypstSnippet(opts, csv))
    : TEMPLATES.find((t) => t.id === activeTemplateId)?.snippet(projectFormat) ?? null

  const handleCopy = useCallback(() => {
    if (!snippet) return
    navigator.clipboard.writeText(snippet).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }, [snippet])

  const handleInsert = useCallback(() => {
    if (!snippet) return
    onInsertAtCursor(snippet)
  }, [snippet, onInsertAtCursor])

  const toggleYCol = useCallback((col: string) => {
    setOpts((prev) => {
      const has = prev.yCols.includes(col)
      return { ...prev, yCols: has ? prev.yCols.filter((c) => c !== col) : [...prev.yCols, col] }
    })
  }, [])

  const pkgNote = projectFormat === 'typst'
    ? 'Requires @preview/cetz:0.4.2 and @preview/cetz-plot:0.1.3'
    : activeTab === 'csv'
      ? 'CSV plots generate pgfplots snippets. Requires \\usepackage{pgfplots}.'
      : 'Diagram templates generate TikZ snippets. Requires \\usepackage{tikz}.'

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div>
        <p style={{ color: 'var(--text-bright)', fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
          {projectFormat === 'latex'
            ? activeTab === 'csv'
              ? 'pgfplots'
              : 'TikZ'
            : 'CeTZ Plots'} Generator
        </p>
        <p className={styles.hint}>{pkgNote}</p>
      </div>

      {/* Inner tab bar */}
      <div className={styles.innerTabBar}>
        <button
          className={[styles.innerTab, activeTab === 'csv' ? styles.innerTabActive : ''].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('csv')}
        >
          CSV {'->'} pgfplots
        </button>
        <button
          className={[styles.innerTab, activeTab === 'templates' ? styles.innerTabActive : ''].filter(Boolean).join(' ')}
          onClick={() => setActiveTab('templates')}
        >
          Templates
        </button>
      </div>

      {/* ── CSV Plot tab ── */}
      {activeTab === 'csv' ? (
        <>
          {/* Upload */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Data Source</span>
            {!csv ? (
              <>
                <button
                  className={[styles.uploadZone, isDragging ? styles.uploadZoneDragging : ''].filter(Boolean).join(' ')}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  <span className={styles.uploadZoneIcon}>📊</span>
                  <span>Upload CSV file</span>
                  <span className={styles.uploadZoneHint}>or drag & drop — .csv with header row</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  className={styles.hiddenInput}
                  onChange={handleFileChange}
                />
                {csvError ? <p className={styles.errorText}>{csvError}</p> : null}
                <p className={styles.hint}>No CSV? A skeleton snippet will be generated — replace the sample coordinates.</p>
              </>
            ) : (
              <div className={styles.csvPreview}>
                <span className={styles.csvFileName}>{csv.fileName}</span>
                <span className={styles.csvMeta}>{csv.rows.length} rows · {csv.headers.length} columns</span>
                <div className={styles.csvTableWrapper}>
                  <table className={styles.csvTable}>
                    <thead>
                      <tr>{csv.headers.map((h) => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {csv.rows.slice(0, 5).map((row, i) => (
                        <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button className={styles.clearBtn} onClick={() => { setCsv(null); setCsvError(null) }} title="Remove CSV" aria-label="Remove CSV">
                  <X size={15} aria-hidden />
                </button>
              </div>
            )}
          </div>

          {/* Chart type */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Chart Type</span>
            <div className={styles.chartTypeRow}>
              {CHART_TYPES.map(({ id, label }) => (
                <button
                  key={id}
                  className={[styles.chartChip, opts.chartType === id ? styles.chartChipActive : ''].filter(Boolean).join(' ')}
                  onClick={() => setOpts((p) => ({ ...p, chartType: id }))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Column mapping — only when CSV is loaded */}
          {csv ? (
            <div className={styles.section}>
              <span className={styles.sectionTitle}>Column Mapping</span>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>X Axis Column</label>
                <select
                  className={styles.fieldSelect}
                  value={opts.xCol}
                  onChange={(e) => setOpts((p) => ({ ...p, xCol: e.target.value }))}
                >
                  {csv.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Y Axis Column(s) — click to toggle</label>
                <div className={styles.chartTypeRow}>
                  {csv.headers.filter((h) => h !== opts.xCol).map((h) => (
                    <button
                      key={h}
                      className={[styles.chartChip, opts.yCols.includes(h) ? styles.chartChipActive : ''].filter(Boolean).join(' ')}
                      onClick={() => toggleYCol(h)}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* Labels */}
          <div className={styles.section}>
            <span className={styles.sectionTitle}>Labels</span>
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Title</label>
              <input className={styles.fieldInput} placeholder="My Plot" value={opts.title} onChange={(e) => setOpts((p) => ({ ...p, title: e.target.value }))} />
            </div>
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>X Label</label>
                <input className={styles.fieldInput} placeholder="x" value={opts.xLabel} onChange={(e) => setOpts((p) => ({ ...p, xLabel: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Y Label</label>
                <input className={styles.fieldInput} placeholder="y" value={opts.yLabel} onChange={(e) => setOpts((p) => ({ ...p, yLabel: e.target.value }))} />
              </div>
            </div>
            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Caption</label>
                <input className={styles.fieldInput} placeholder="Caption text" value={opts.caption} onChange={(e) => setOpts((p) => ({ ...p, caption: e.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Figure Label</label>
                <input className={styles.fieldInput} placeholder="fig:plot" value={opts.figLabel} onChange={(e) => setOpts((p) => ({ ...p, figLabel: e.target.value }))} />
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* ── Templates tab ── */}
      {activeTab === 'templates' ? (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Figure Templates</span>
          <div className={styles.templateGrid}>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className={[styles.templateCard, activeTemplateId === t.id ? styles.templateCardActive : ''].filter(Boolean).join(' ')}
                onClick={() => setActiveTemplateId((prev) => prev === t.id ? null : t.id)}
              >
                <span className={styles.templateName}>{t.name}</span>
                <span className={styles.templateDesc}>{t.description}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Generated snippet */}
      {snippet ? (
        <div className={styles.section}>
          <span className={styles.sectionTitle}>Generated Snippet</span>
          <pre className={styles.snippetBox}>{snippet}</pre>
          <div className={styles.snippetActions}>
            <button className={styles.copyBtn} onClick={handleCopy} title={copied ? 'Copied' : 'Copy snippet'} aria-label={copied ? 'Copied' : 'Copy snippet'}>
              {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
            </button>
            <button className={styles.insertBtn} disabled={!canEdit} onClick={handleInsert} title="Insert at cursor" aria-label="Insert at cursor">
              <FileOutput size={15} aria-hidden />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
