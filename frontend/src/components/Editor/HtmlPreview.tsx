import styles from './HtmlPreview.module.css'

interface Props {
  html: string | null
  compileError: string | null
  isCompiling: boolean
}

export default function HtmlPreview({ html, compileError, isCompiling }: Props) {
  if (isCompiling) {
    return (
      <div className={styles.placeholder}>
        <div className={styles.spinner} />
        <span>Compiling…</span>
      </div>
    )
  }

  if (compileError && !html) {
    return (
      <div className={styles.placeholder}>
        <p>Open the compile output panel to review the latest compiler messages.</p>
      </div>
    )
  }

  if (!html) {
    return (
      <div className={styles.placeholder}>
        <p>Press <kbd>Ctrl+Enter</kbd> or click <strong>▶ Render</strong> to preview</p>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <iframe
        className={styles.frame}
        title="LaTeX web preview"
        srcDoc={html}
        sandbox="allow-scripts"
      />
    </div>
  )
}
