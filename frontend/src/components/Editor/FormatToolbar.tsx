import styles from './FormatToolbar.module.css'

type ProjectFormat = 'typst' | 'latex' | 'plain'

interface FormatAction {
  id: string
  label: string
  title: string
  prefix: string
  suffix: string
  placeholder: string
  bold?: boolean
  italic?: boolean
}

interface FormatGroup {
  actions: FormatAction[]
}

const LATEX_GROUPS: FormatGroup[] = [
  {
    actions: [
      { id: 'bold',      label: 'B',     title: 'Bold (\\textbf)',      prefix: '\\textbf{',   suffix: '}',              placeholder: 'text',       bold: true },
      { id: 'italic',    label: 'I',     title: 'Italic (\\textit)',     prefix: '\\textit{',   suffix: '}',              placeholder: 'text',       italic: true },
      { id: 'underline', label: 'U̲',    title: 'Underline',            prefix: '\\underline{', suffix: '}',             placeholder: 'text' },
      { id: 'emph',      label: 'em',    title: 'Emphasize (\\emph)',   prefix: '\\emph{',     suffix: '}',              placeholder: 'text' },
    ],
  },
  {
    actions: [
      { id: 'section',    label: '§',    title: 'Section',              prefix: '\\section{',        suffix: '}',         placeholder: 'Title' },
      { id: 'subsection', label: '§§',   title: 'Subsection',           prefix: '\\subsection{',     suffix: '}',         placeholder: 'Title' },
      { id: 'subsubsection', label: '§§§', title: 'Subsubsection',    prefix: '\\subsubsection{',  suffix: '}',         placeholder: 'Title' },
    ],
  },
  {
    actions: [
      { id: 'inlinemath',  label: '$',   title: 'Inline math',          prefix: '$',            suffix: '$',             placeholder: 'x' },
      { id: 'dispmath',    label: '$$',  title: 'Display math',         prefix: '\\[\n  ',      suffix: '\n\\]',         placeholder: 'x = y' },
      { id: 'equation',    label: 'eq',  title: 'Equation environment', prefix: '\\begin{equation}\n  ', suffix: '\n\\end{equation}', placeholder: 'x = y \\label{eq:label}' },
    ],
  },
  {
    actions: [
      { id: 'itemize',   label: '•–',   title: 'Unordered list',       prefix: '\\begin{itemize}\n  \\item ', suffix: '\n\\end{itemize}', placeholder: 'First item' },
      { id: 'enumerate', label: '1–',   title: 'Ordered list',         prefix: '\\begin{enumerate}\n  \\item ', suffix: '\n\\end{enumerate}', placeholder: 'First item' },
    ],
  },
  {
    actions: [
      { id: 'verbatim',  label: '{}',   title: 'Verbatim / code',      prefix: '\\begin{verbatim}\n', suffix: '\n\\end{verbatim}', placeholder: 'code here' },
      { id: 'lstlisting',label: '</>', title: 'Listing (lstlisting)',   prefix: '\\begin{lstlisting}[language=Python]\n', suffix: '\n\\end{lstlisting}', placeholder: '# code here' },
    ],
  },
  {
    actions: [
      { id: 'figure',    label: '⊡',    title: 'Figure',               prefix: '\\begin{figure}[ht]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{', suffix: '}\n  \\caption{Caption}\n  \\label{fig:label}\n\\end{figure}', placeholder: 'figures/image.pdf' },
      { id: 'table',     label: '⊞',    title: 'Table',                prefix: '\\begin{table}[ht]\n  \\centering\n  \\begin{tabular}{cc}\n    \\hline\n    ', suffix: ' \\\\\n    \\hline\n  \\end{tabular}\n  \\caption{Caption}\n  \\label{tab:label}\n\\end{table}', placeholder: 'A & B' },
    ],
  },
  {
    actions: [
      { id: 'cite',      label: '[@]',  title: 'Citation (\\cite)',    prefix: '\\cite{',      suffix: '}',              placeholder: 'key' },
      { id: 'ref',       label: '[→]',  title: 'Reference (\\ref)',    prefix: '\\ref{',       suffix: '}',              placeholder: 'label' },
      { id: 'label',     label: '⊕',    title: 'Label (\\label)',      prefix: '\\label{',     suffix: '}',              placeholder: 'label' },
      { id: 'comment',   label: '%',    title: 'Comment',              prefix: '% ',            suffix: '',              placeholder: 'comment' },
    ],
  },
]

const TYPST_GROUPS: FormatGroup[] = [
  {
    actions: [
      { id: 'bold',    label: 'B',   title: 'Bold (*text*)',        prefix: '*',          suffix: '*',          placeholder: 'bold',       bold: true },
      { id: 'italic',  label: 'I',   title: 'Italic (_text_)',      prefix: '_',          suffix: '_',          placeholder: 'italic',     italic: true },
      { id: 'strike',  label: '~~',  title: 'Strikethrough',       prefix: '#strike[',   suffix: ']',          placeholder: 'text' },
      { id: 'code',    label: '`',   title: 'Inline code',          prefix: '`',          suffix: '`',          placeholder: 'code' },
    ],
  },
  {
    actions: [
      { id: 'h1', label: 'H1', title: 'Heading 1',  prefix: '= ',  suffix: '', placeholder: 'Title' },
      { id: 'h2', label: 'H2', title: 'Heading 2',  prefix: '== ', suffix: '', placeholder: 'Title' },
      { id: 'h3', label: 'H3', title: 'Heading 3',  prefix: '=== ', suffix: '', placeholder: 'Title' },
    ],
  },
  {
    actions: [
      { id: 'inlinemath', label: '$',  title: 'Inline math',     prefix: '$',       suffix: '$',       placeholder: 'x' },
      { id: 'dispmath',   label: '$$', title: 'Display math',    prefix: '$ ',      suffix: ' $',      placeholder: 'x = y' },
    ],
  },
  {
    actions: [
      { id: 'list',     label: '•–', title: 'List item',       prefix: '- ',         suffix: '',        placeholder: 'item' },
      { id: 'numbered', label: '1–', title: 'Numbered list',   prefix: '+ ',         suffix: '',        placeholder: 'item' },
      { id: 'codeblock',label: '```', title: 'Code block',     prefix: '```\n',      suffix: '\n```',   placeholder: '// code' },
    ],
  },
  {
    actions: [
      { id: 'figure', label: '⊡',  title: 'Figure',    prefix: '#figure(\n  image("', suffix: '"),\n  caption: [Caption],\n) <fig:label>', placeholder: 'path/to/image.png' },
      { id: 'table',  label: '⊞',  title: 'Table',     prefix: '#table(\n  columns: 2,\n  [', suffix: '], [B],\n) <tab:label>', placeholder: 'A' },
    ],
  },
  {
    actions: [
      { id: 'label',  label: '<L>',  title: 'Label',        prefix: ' <',    suffix: '>',     placeholder: 'label' },
      { id: 'ref',    label: '@',    title: 'Reference',    prefix: '@',     suffix: '',      placeholder: 'label' },
      { id: 'cite',   label: '[@]',  title: 'Citation',     prefix: '@',     suffix: '',      placeholder: 'key' },
      { id: 'comment',label: '//',   title: 'Comment',      prefix: '// ',   suffix: '',      placeholder: 'comment' },
    ],
  },
]

interface Props {
  projectFormat: ProjectFormat
  onFormat: (prefix: string, suffix: string, placeholder: string) => void
}

export default function FormatToolbar({ projectFormat, onFormat }: Props) {
  if (projectFormat === 'plain') return null

  const groups = projectFormat === 'latex' ? LATEX_GROUPS : TYPST_GROUPS

  return (
    <div className={styles.bar} role="toolbar" aria-label="Format toolbar">
      {groups.map((group, gi) => (
        <span key={gi} className={styles.group}>
          {gi > 0 ? <span className={styles.sep} aria-hidden /> : null}
          {group.actions.map((action) => (
            <button
              key={action.id}
              className={[
                styles.btn,
                action.bold ? styles.btnBold : '',
                action.italic ? styles.btnItalic : '',
              ].filter(Boolean).join(' ')}
              title={action.title}
              onClick={() => onFormat(action.prefix, action.suffix, action.placeholder)}
            >
              {action.label}
            </button>
          ))}
        </span>
      ))}
    </div>
  )
}
