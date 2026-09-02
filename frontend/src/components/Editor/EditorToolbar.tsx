import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Share2, Loader2, Play, Settings, Globe, FileText } from '../../icons'
import CollaboratorAvatars from './CollaboratorAvatars'
import { useGeminiContext } from '../../context/GeminiContext'
import type { Awareness } from 'y-protocols/awareness'
import type { CompilePreviewFormat, ProjectRole } from '../../types'
import styles from './EditorToolbar.module.css'

type LatexCompilerOption = {
  value: string
  label: string
}

type CollaboratorPresence = {
  clientId: number
  userName: string
  color: string
  avatarUrl: string | null
}

interface Props {
  title: string
  activeFileName: string
  mainFileName: string | null
  role: ProjectRole
  canRender: boolean
  previewMode: CompilePreviewFormat
  previewModeOptions?: CompilePreviewFormat[]
  onPreviewModeChange: (mode: CompilePreviewFormat) => void
  onTitleChange: (title: string) => Promise<void>
  awareness: Awareness
  saveStatus: 'saved' | 'unsaved' | 'saving'
  isCompiling: boolean
  compileError: string | null
  onShare: (button: HTMLButtonElement) => void
  onCompile: () => void
  onToggleSidebar?: () => void
  showSidebarToggle?: boolean
  connectionError: string | null
  connectionStatus?: 'connecting' | 'connected' | 'disconnected'
  collaborators?: CollaboratorPresence[]
  onOpenSettings?: () => void
  latexCompiler?: string | null
  latexCompilerOptions?: LatexCompilerOption[]
  onLatexCompilerChange?: (compiler: string) => void
}

export default function EditorToolbar({
  title,
  activeFileName,
  mainFileName,
  role,
  canRender,
  previewMode,
  previewModeOptions = ['svg', 'pdf'],
  onPreviewModeChange,
  onTitleChange,
  awareness,
  saveStatus,
  isCompiling,
  compileError,
  onShare,
  onCompile,
  onToggleSidebar,
  showSidebarToggle = false,
  connectionError,
  connectionStatus = 'connected',
  collaborators = [],
  onOpenSettings,
  latexCompiler = null,
  latexCompilerOptions = [],
  onLatexCompilerChange,
}: Props) {
  const navigate = useNavigate()
  const { isCoAuthorEnabled } = useGeminiContext()
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState(title)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setTitleValue(title) }, [title])

  useEffect(() => {
    if (!overflowOpen) return
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false)
      }
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [overflowOpen])

  async function saveTitle() {
    if (role === 'viewer') {
      setEditingTitle(false)
      setTitleValue(title)
      return
    }
    const trimmed = titleValue.trim() || 'Untitled'
    setEditingTitle(false)
    if (trimmed === title) return
    await onTitleChange(trimmed)
  }

  const hasAlert = compileError || connectionError || connectionStatus !== 'connected'
  const canUseSvgPreview = previewModeOptions.includes('svg')
  const canUsePdfPreview = previewModeOptions.includes('pdf')

  return (
    <div className={styles.toolbar}>
      <button className={styles.backBtn} onClick={() => navigate('/')} title="Back to projects">
        ←
      </button>
      <button className={styles.logoBtn} onClick={() => navigate('/')} title="Go to home" aria-label="Go to home">
        <img src="/logo.svg" alt="" aria-hidden="true" />
        <span className={styles.logoText}>Typstr</span>
      </button>

      {showSidebarToggle && onToggleSidebar ? (
        <button className={styles.secondaryBtn} onClick={onToggleSidebar} title="Toggle sidebar">
          ☰
        </button>
      ) : null}

      <div className={styles.titleArea}>
        {editingTitle ? (
          <input
            className={styles.titleInput}
            value={titleValue}
            autoFocus
            maxLength={255}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle()
              if (e.key === 'Escape') { setTitleValue(title); setEditingTitle(false) }
            }}
          />
        ) : (
          <span
            className={styles.titleDisplay}
            onClick={() => role !== 'viewer' && setEditingTitle(true)}
            title={role === 'viewer' ? 'Review mode: read-only source' : 'Click to rename'}
          >
            {title}
          </span>
        )}
        {/* Badges hidden on mobile, shown in overflow menu */}
        <span className={`${styles.fileBadge} ${styles.desktopOnly}`}>Editing: {activeFileName}</span>
        {mainFileName ? (
          <span className={`${styles.fileBadge} ${styles.desktopOnly}`}>Main: {mainFileName}</span>
        ) : null}
        {role === 'viewer' ? (
          <span className={`${styles.fileBadge} ${styles.desktopOnly}`}>Mode: Review</span>
        ) : null}
      </div>

      <div className={styles.actions}>
        {/* Save status — hidden on mobile */}
        <span className={`${saveStatus === 'saved' ? styles.saved : saveStatus === 'saving' ? styles.saving : styles.unsaved} ${styles.desktopOnly}`}>
          {saveStatus === 'saving' ? 'Saving to Drive…' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
        </span>

        <CollaboratorAvatars awareness={awareness} isGeminiEnabled={isCoAuthorEnabled} collaborators={collaborators} />

        {/* Connection / compile alerts — always shown */}
        {connectionError ? (
          <span className={styles.errorBadge} title={connectionError}>Connection issue</span>
        ) : connectionStatus !== 'connected' ? (
          <span className={connectionStatus === 'connecting' ? styles.warningBadge : styles.errorBadge}>
            {connectionStatus === 'connecting' ? 'Reconnecting…' : 'Offline'}
          </span>
        ) : null}

        {compileError && (
          <span className={styles.errorBadge} title={compileError}>⚠ Error</span>
        )}

        {/* Preview mode toggle — hidden on mobile (in overflow) */}
        <div className={`${styles.previewModeToggle} ${styles.desktopOnly}`}>
          {!latexCompiler && previewMode === 'pdf' ? (
            <span className={styles.warningBadge} title="Typst PDF preview uses server-side compilation.">
              PDF (server compile)
            </span>
          ) : null}
          {canUseSvgPreview ? (
            <button
              className={previewMode === 'svg' ? styles.previewModeBtnActive : styles.previewModeBtn}
              onClick={() => onPreviewModeChange('svg')}
              disabled={!canRender}
              title="Web Preview"
              aria-label="Web Preview"
            >
              <Globe size={16} aria-hidden />
            </button>
          ) : null}
          {canUsePdfPreview ? (
            <button
              className={previewMode === 'pdf' ? styles.previewModeBtnActive : styles.previewModeBtn}
              onClick={() => onPreviewModeChange('pdf')}
              disabled={!canRender}
              title="PDF Preview"
              aria-label="PDF Preview"
            >
              <FileText size={16} aria-hidden />
            </button>
          ) : null}
        </div>

        {/* LaTeX compiler selector — hidden on mobile (in overflow) */}
        {latexCompiler && latexCompilerOptions.length > 0 && onLatexCompilerChange ? (
          <label className={`${styles.compilerSelectLabel} ${styles.desktopOnly}`}>
            <span>Engine</span>
            <select
              className={styles.compilerSelect}
              value={latexCompiler}
              onChange={(event) => onLatexCompilerChange(event.target.value)}
              disabled={isCompiling}
              title="LaTeX preview/compiler engine"
              aria-label="LaTeX preview/compiler engine"
            >
              {latexCompilerOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}

        {role === 'owner' ? (
          <button className={styles.secondaryBtn} onClick={(event) => onShare(event.currentTarget)} title="Share" aria-label="Share">
            <Share2 size={18} aria-hidden />
          </button>
        ) : null}

        <button
          className={styles.compileBtn}
          onClick={onCompile}
          disabled={isCompiling || !canRender}
          title={isCompiling ? 'Rendering…' : 'Render (Ctrl+Enter)'}
          aria-label="Render"
        >
          {isCompiling ? (
            <Loader2 size={18} className={styles.spinIcon} aria-hidden />
          ) : (
            <Play size={18} fill="currentColor" strokeWidth={0} aria-hidden />
          )}
        </button>

        {onOpenSettings ? (
          <button
            className={styles.settingsBtn}
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={18} aria-hidden />
          </button>
        ) : null}

        {/* Overflow menu — mobile only */}
        <div className={`${styles.overflowWrapper} ${styles.mobileOnly}`} ref={overflowRef}>
          <button
            className={`${styles.settingsBtn} ${hasAlert ? styles.settingsBtnAlert : ''}`}
            onClick={() => setOverflowOpen((v) => !v)}
            aria-label="More options"
            title="More options"
          >
            ⋯
          </button>
          {overflowOpen && (
            <div className={styles.overflowMenu}>
              {/* Save status */}
              <div className={styles.overflowItem}>
                <span className={saveStatus === 'saved' ? styles.saved : saveStatus === 'saving' ? styles.saving : styles.unsaved}>
                  {saveStatus === 'saving' ? 'Saving to Drive…' : saveStatus === 'unsaved' ? 'Unsaved changes' : 'Saved'}
                </span>
              </div>

              {/* File info */}
              <div className={styles.overflowItem}>
                <span className={styles.overflowLabel}>Editing:</span>
                <span className={styles.overflowValue}>{activeFileName}</span>
              </div>
              {mainFileName ? (
                <div className={styles.overflowItem}>
                  <span className={styles.overflowLabel}>Main:</span>
                  <span className={styles.overflowValue}>{mainFileName}</span>
                </div>
              ) : null}
              {role === 'viewer' ? (
                <div className={styles.overflowItem}>
                  <span className={styles.fileBadge}>Mode: Review</span>
                </div>
              ) : null}

              <div className={styles.overflowDivider} />

              {/* Preview mode */}
              {canRender && previewModeOptions.length > 0 ? (
                <div className={styles.overflowItem}>
                  <span className={styles.overflowLabel}>Preview</span>
                  <div className={styles.previewModeToggle}>
                    {canUseSvgPreview ? (
                      <button
                        className={previewMode === 'svg' ? styles.previewModeBtnActive : styles.previewModeBtn}
                        onClick={() => { onPreviewModeChange('svg'); setOverflowOpen(false) }}
                        title="Web Preview"
                        aria-label="Web Preview"
                      >
                        <Globe size={16} aria-hidden />
                      </button>
                    ) : null}
                    {canUsePdfPreview ? (
                      <button
                        className={previewMode === 'pdf' ? styles.previewModeBtnActive : styles.previewModeBtn}
                        onClick={() => { onPreviewModeChange('pdf'); setOverflowOpen(false) }}
                        title="PDF Preview"
                        aria-label="PDF Preview"
                      >
                        <FileText size={16} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* LaTeX compiler */}
              {latexCompiler && latexCompilerOptions.length > 0 && onLatexCompilerChange ? (
                <div className={styles.overflowItem}>
                  <span className={styles.overflowLabel}>Engine</span>
                  <select
                    className={styles.compilerSelect}
                    value={latexCompiler}
                    onChange={(e) => { onLatexCompilerChange(e.target.value); setOverflowOpen(false) }}
                    disabled={isCompiling}
                  >
                    {latexCompilerOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              ) : null}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
