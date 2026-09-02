import { useEffect, useRef, useState } from 'react'
import { autocompletion, completionKeymap, type Completion, type CompletionContext } from '@codemirror/autocomplete'
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, lineNumbers, highlightActiveLineGutter, type Command, type ViewUpdate, type DecorationSet } from '@codemirror/view'
import { Compartment, EditorSelection, EditorState, RangeSetBuilder, StateEffect, StateField, Transaction } from '@codemirror/state'
import { defaultKeymap, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, codeFolding, foldGutter, foldKeymap, foldService, syntaxHighlighting, toggleFold } from '@codemirror/language'
import { closeSearchPanel, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { oneDark } from '@codemirror/theme-one-dark'
import { tags } from '@lezer/highlight'
import { typst } from 'codemirror-lang-typst'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { AiEditSuggestion, CommentSelectionAnchor, ProjectComment } from '../../types'
import type { EditorSignatureHint } from './editorLearning'
import { useGemini } from '../../hooks/useGemini'
import { useGeminiContext } from '../../context/GeminiContext'
import { GeminiPromptDialog } from './GeminiPromptDialog'
import { Check, X } from '../../icons'
import styles from './EditorPage.module.css'

interface Props {
  ytext: Y.Text
  awareness: Awareness
  projectId: string
  comments?: ProjectComment[]
  highlightedCommentId?: string | null
  aiEditSuggestions?: AiEditSuggestion[]
  onAiEditDecision?: (editId: string, action: 'accept' | 'reject') => void
  onAiEditBulkDecision?: (action: 'accept' | 'reject') => void
  onCompile?: () => void
  onChange?: (source: string) => void
  onLocalEdit?: (previousSource: string, nextSource: string) => void
  onSave?: () => void
  readOnly?: boolean
  editorLanguage?: 'typst' | 'latex' | 'plain'
  currentFilePath?: string
  projectFiles?: Array<{ path: string; mimeType: string }>
  projectTextEntries?: Array<{ path: string; mimeType: string; content: string }>
  packageSuggestions?: Array<{ label: string; detail: string }>
  editorMode?: 'dark' | 'light'
  fontFamily?: string
  fontSize?: number
  insertRequest?: { text: string; selectInsertedText?: boolean; appendOnly?: boolean; replaceBefore?: number; nonce: number } | null
  formatRequest?: { prefix: string; suffix: string; placeholder: string; nonce: number } | null
  revealLocation?: { line: number; column?: number; endLine?: number; endColumn?: number; nonce: number } | null
  searchPanelRequest?: { action: 'open' | 'close'; nonce: number } | null
  onCursorLocationChange?: (location: { line: number; column: number }) => void
  onSelectionRangeChange?: (selection: CommentSelectionAnchor | null) => void
  onStartCommentFromSelection?: (selection: CommentSelectionAnchor) => void
  onCommentActivate?: (commentId: string) => void
  shortcutBindings?: ShortcutBindings
  onOpenSearch?: () => void
  onOpenProjectSearch?: () => void
  onToggleNavigation?: () => void
  onQuickExport?: () => void
  onTogglePreview?: () => void
  onFocusEditor?: () => void
  onSignatureHelpChange?: (hint: EditorSignatureHint | null) => void
  onResolveCitationIdentifier?: (identifier: string) => Promise<string | null>
  onCiteSearch?: (query: string, anchorRect: DOMRect | null, shortcutMode?: boolean, triggerLength?: number) => void
  onCiteSearchClose?: () => void
  citeSearchOpen?: boolean
}

const refreshCommentDecorationsEffect = StateEffect.define<null>()
const refreshAiEditDecorationsEffect = StateEffect.define<null>()
const setSuggestionEffect = StateEffect.define<string | null>()

const suggestionField = StateField.define<string | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSuggestionEffect)) return effect.value
    }
    if (tr.docChanged) return null
    return value
  },
})

type ShortcutAction =
  | 'compile'
  | 'save'
  | 'search'
  | 'projectSearch'
  | 'toggleNavigation'
  | 'quickExport'
  | 'previousSection'
  | 'nextSection'
  | 'toggleFold'
  | 'togglePreview'
  | 'focusEditor'
  | 'insertCite'

type ShortcutBindings = Record<ShortcutAction, string>

type TooltipEntry = {
  label: string
  kind: 'function' | 'keyword' | 'variable' | 'module' | 'label' | 'citation' | 'note'
  summary: string
  signature?: string
  parameters?: string[]
  sourcePath?: string
}

type TypstDocEntry = TooltipEntry
type EditorLanguage = 'typst' | 'latex' | 'plain'

type TooltipState = {
  left: number
  top: number
  entry: TooltipEntry
  activeParameter: number | null
}

type EditorAssistData = {
  docLookup: Map<string, TypstDocEntry>
  typstHashCommandOptions: Completion[]
  typstReferenceOptions: Completion[]
  latexReferenceOptions: Completion[]
  latexCitationOptions: Completion[]
}

const LIGHT_EDITOR_COLORS = {
  background: 'var(--editor-bg)',
  text: 'var(--text-bright)',
  border: 'var(--panel-border)',
  selection: 'var(--active-bg)',
  caret: 'var(--accent)',
  gutterText: 'var(--muted-text)',
}

const DARK_EDITOR_COLORS = {
  background: 'var(--editor-bg)',
  text: 'var(--text-bright)',
  border: 'var(--panel-border)',
  selection: 'var(--active-bg)',
  caret: 'var(--accent)',
  gutterText: 'var(--muted-text)',
}

const LIGHT_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: 'var(--accent-strong)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning)' },
  { tag: [tags.comment], color: 'var(--muted-text)', fontStyle: 'italic' },
  { tag: [tags.heading], color: 'var(--accent)', fontWeight: '700' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--accent)' },
  { tag: [tags.typeName, tags.className], color: 'var(--accent-soft)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--text-bright)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--text-soft)' },
])

const DARK_HIGHLIGHT_STYLE = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], color: 'var(--warning)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--success)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--warning)', },
  { tag: [tags.comment], color: 'var(--muted-text)', fontStyle: 'italic' },
  { tag: [tags.heading], color: 'var(--accent-soft)', fontWeight: '700' },
  { tag: [tags.function(tags.variableName), tags.labelName], color: 'var(--accent)' },
  { tag: [tags.typeName, tags.className], color: 'var(--accent-soft)' },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName], color: 'var(--text-bright)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--text-soft)' },
])

const jumpToPreviousSection: Command = (view) => moveToTypstSection(view, -1)
const jumpToNextSection: Command = (view) => moveToTypstSection(view, 1)

export default function CodeMirrorEditor({
  ytext,
  awareness,
  projectId,
  comments = [],
  highlightedCommentId,
  aiEditSuggestions = [],
  onAiEditDecision,
  onAiEditBulkDecision,
  onCompile,
  onChange,
  onLocalEdit,
  onSave,
  readOnly = false,
  editorLanguage = 'plain',
  currentFilePath,
  projectFiles = [],
  projectTextEntries = [],
  packageSuggestions = [],
  editorMode = 'dark',
  fontFamily = '"Cascadia Code", "SFMono-Regular", Menlo, monospace',
  fontSize = 14,
  insertRequest,
  formatRequest,
  revealLocation,
  searchPanelRequest,
  onCursorLocationChange,
  onSelectionRangeChange,
  onStartCommentFromSelection,
  onCommentActivate,
  shortcutBindings,
  onOpenSearch,
  onOpenProjectSearch,
  onToggleNavigation,
  onQuickExport,
  onTogglePreview,
  onFocusEditor,
  onSignatureHelpChange,
  onResolveCitationIdentifier,
  onCiteSearch,
  onCiteSearchClose,
  citeSearchOpen,
}: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onCompileRef = useRef(onCompile)
  const onChangeRef = useRef(onChange)
  const onLocalEditRef = useRef(onLocalEdit)
  const onSaveRef = useRef(onSave)
  const onOpenSearchRef = useRef(onOpenSearch)
  const onOpenProjectSearchRef = useRef(onOpenProjectSearch)
  const onToggleNavigationRef = useRef(onToggleNavigation)
  const onQuickExportRef = useRef(onQuickExport)
  const onTogglePreviewRef = useRef(onTogglePreview)
  const onFocusEditorRef = useRef(onFocusEditor)
  const onSignatureHelpChangeRef = useRef(onSignatureHelpChange)
  const onResolveCitationIdentifierRef = useRef(onResolveCitationIdentifier)
  const onCiteSearchRef = useRef(onCiteSearch)
  const onCiteSearchCloseRef = useRef(onCiteSearchClose)
  const citeShortcutModeRef = useRef(false)
  const onCursorLocationChangeRef = useRef(onCursorLocationChange)
  const onSelectionRangeChangeRef = useRef(onSelectionRangeChange)
  const onStartCommentFromSelectionRef = useRef(onStartCommentFromSelection)
  const onCommentActivateRef = useRef(onCommentActivate)
  const onAiEditDecisionRef = useRef(onAiEditDecision)
  const currentFilePathRef = useRef(currentFilePath)
  const projectFilesRef = useRef(projectFiles)
  const projectTextEntriesRef = useRef(projectTextEntries)
  const packageSuggestionsRef = useRef(packageSuggestions)
  const commentsRef = useRef(comments)
  const aiEditSuggestionsRef = useRef(aiEditSuggestions)
  const commentLookupRef = useRef<Map<string, ProjectComment>>(new Map())
  const highlightedCommentIdRef = useRef(highlightedCommentId)
  const syntaxThemeCompartmentRef = useRef(new Compartment())
  const editorThemeCompartmentRef = useRef(new Compartment())
  const assistDataRef = useRef<EditorAssistData>(buildEditorAssistData(editorLanguage, projectTextEntries))
  const [hoverTooltipState, setHoverTooltipState] = useState<TooltipState | null>(null)
  const [signatureTooltipState, setSignatureTooltipState] = useState<TooltipState | null>(null)
  const [showGemini, setShowGemini] = useState(false)
  const { isCoAuthorEnabled } = useGeminiContext()
  const isCoAuthorEnabledRef = useRef(isCoAuthorEnabled)
  const gemini = useGemini()
  const suggestionTimeoutRef = useRef<any>(null)
  const hoverTooltipFrameRef = useRef<number | null>(null)
  const awarenessCursorTimerRef = useRef<number | null>(null)
  const signatureTooltipTimerRef = useRef<number | null>(null)

  useEffect(() => { isCoAuthorEnabledRef.current = isCoAuthorEnabled }, [isCoAuthorEnabled])
  useEffect(() => { onCompileRef.current = onCompile }, [onCompile])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => { onLocalEditRef.current = onLocalEdit }, [onLocalEdit])
  useEffect(() => { onSaveRef.current = onSave }, [onSave])
  useEffect(() => { onOpenSearchRef.current = onOpenSearch }, [onOpenSearch])
  useEffect(() => { onOpenProjectSearchRef.current = onOpenProjectSearch }, [onOpenProjectSearch])
  useEffect(() => { onToggleNavigationRef.current = onToggleNavigation }, [onToggleNavigation])
  useEffect(() => { onQuickExportRef.current = onQuickExport }, [onQuickExport])
  useEffect(() => { onTogglePreviewRef.current = onTogglePreview }, [onTogglePreview])
  useEffect(() => { onFocusEditorRef.current = onFocusEditor }, [onFocusEditor])
  useEffect(() => { onSignatureHelpChangeRef.current = onSignatureHelpChange }, [onSignatureHelpChange])
  useEffect(() => { onResolveCitationIdentifierRef.current = onResolveCitationIdentifier }, [onResolveCitationIdentifier])
  useEffect(() => { onCiteSearchRef.current = onCiteSearch }, [onCiteSearch])
  useEffect(() => { onCiteSearchCloseRef.current = onCiteSearchClose }, [onCiteSearchClose])
  useEffect(() => { if (!citeSearchOpen) citeShortcutModeRef.current = false }, [citeSearchOpen])
  useEffect(() => { onCursorLocationChangeRef.current = onCursorLocationChange }, [onCursorLocationChange])
  useEffect(() => { onSelectionRangeChangeRef.current = onSelectionRangeChange }, [onSelectionRangeChange])
  useEffect(() => { onStartCommentFromSelectionRef.current = onStartCommentFromSelection }, [onStartCommentFromSelection])
  useEffect(() => { onCommentActivateRef.current = onCommentActivate }, [onCommentActivate])
  useEffect(() => { onAiEditDecisionRef.current = onAiEditDecision }, [onAiEditDecision])
  useEffect(() => { currentFilePathRef.current = currentFilePath }, [currentFilePath])
  useEffect(() => { projectFilesRef.current = projectFiles }, [projectFiles])
  useEffect(() => { projectTextEntriesRef.current = projectTextEntries }, [projectTextEntries])
  useEffect(() => { packageSuggestionsRef.current = packageSuggestions }, [packageSuggestions])
  useEffect(() => { commentsRef.current = comments }, [comments])
  useEffect(() => { aiEditSuggestionsRef.current = aiEditSuggestions }, [aiEditSuggestions])
  useEffect(() => { commentLookupRef.current = new Map(comments.map((comment) => [comment.id, comment])) }, [comments])
  useEffect(() => { highlightedCommentIdRef.current = highlightedCommentId }, [highlightedCommentId])

  useEffect(() => {
    assistDataRef.current = buildEditorAssistData(editorLanguage, projectTextEntries)
  }, [editorLanguage, projectTextEntries])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !searchPanelRequest) {
      return
    }

    if (searchPanelRequest.action === 'open') {
      openSearchPanel(view)
    } else {
      closeSearchPanel(view)
    }

    view.focus()
  }, [searchPanelRequest])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !revealLocation) {
      return
    }

    const lineNumber = Math.max(1, revealLocation.line)
    const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines))
    const columnOffset = Math.max(0, (revealLocation.column ?? 1) - 1)
    const anchor = Math.min(line.to, line.from + columnOffset)

    const hasRange = revealLocation.endLine != null && revealLocation.endColumn != null
    if (hasRange) {
      const endLineNumber = Math.max(1, revealLocation.endLine!)
      const endLine = view.state.doc.line(Math.min(endLineNumber, view.state.doc.lines))
      const endColumnOffset = Math.max(0, revealLocation.endColumn! - 1)
      const head = Math.min(endLine.to, endLine.from + endColumnOffset)
      view.dispatch({
        selection: EditorSelection.range(anchor, head),
        scrollIntoView: true,
      })
    } else {
      view.dispatch({
        selection: EditorSelection.cursor(anchor),
        scrollIntoView: true,
      })
      view.focus()
    }
  }, [revealLocation])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !insertRequest || readOnly) {
      return
    }

    const selection = view.state.selection.main
    const replaceBefore = insertRequest.replaceBefore ?? 0
    const from = insertRequest.appendOnly ? selection.to : Math.max(0, selection.from - replaceBefore)
    const to = insertRequest.appendOnly ? selection.to : selection.to
    const end = from + insertRequest.text.length

    view.dispatch({
      changes: { from, to, insert: insertRequest.text },
      selection: insertRequest.selectInsertedText
        ? EditorSelection.range(from, end)
        : EditorSelection.cursor(end),
      scrollIntoView: true,
    })
    view.focus()
  }, [insertRequest, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !formatRequest || readOnly) return

    const sel = view.state.selection.main
    if (!sel.empty) {
      const selectedText = view.state.sliceDoc(sel.from, sel.to)
      const insert = formatRequest.prefix + selectedText + formatRequest.suffix
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert },
        selection: EditorSelection.range(
          sel.from + formatRequest.prefix.length,
          sel.from + formatRequest.prefix.length + selectedText.length,
        ),
        scrollIntoView: true,
      })
    } else {
      const pos = sel.from
      const insert = formatRequest.prefix + formatRequest.placeholder + formatRequest.suffix
      const selectFrom = pos + formatRequest.prefix.length
      const selectTo = selectFrom + formatRequest.placeholder.length
      view.dispatch({
        changes: { from: pos, to: pos, insert },
        selection: EditorSelection.range(selectFrom, selectTo),
        scrollIntoView: true,
      })
    }
    view.focus()
  }, [formatRequest, readOnly])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    view.dispatch({ effects: refreshCommentDecorationsEffect.of(null) })
  }, [comments, highlightedCommentId])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }

    view.dispatch({ effects: refreshAiEditDecorationsEffect.of(null) })
  }, [aiEditSuggestions])

  useEffect(() => {
    if (!containerRef.current) return

    const undoManager = new Y.UndoManager(ytext)
    const commentDecorations = ViewPlugin.fromClass(class {
      decorations

      constructor(view: EditorView) {
        this.decorations = buildCommentDecorations(view, commentsRef.current, highlightedCommentIdRef.current ?? null)
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged
          || update.viewportChanged
          || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshCommentDecorationsEffect)))
        ) {
          this.decorations = buildCommentDecorations(update.view, commentsRef.current, highlightedCommentIdRef.current ?? null)
        }
      }
    }, {
      decorations: (plugin) => plugin.decorations,
    })
    const latexSyntaxDecorations = ViewPlugin.fromClass(class {
      decorations

      constructor(view: EditorView) {
        this.decorations = buildLatexSyntaxDecorations(view)
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildLatexSyntaxDecorations(update.view)
        }
      }
    }, {
      decorations: (plugin) => plugin.decorations,
    })
    const aiEditDecorations = ViewPlugin.fromClass(class {
      decorations

      constructor(view: EditorView) {
        this.decorations = buildAiEditDecorations(view, aiEditSuggestionsRef.current)
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged
          || update.viewportChanged
          || update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshAiEditDecorationsEffect)))
        ) {
          this.decorations = buildAiEditDecorations(update.view, aiEditSuggestionsRef.current)
        }
      }
    }, {
      decorations: (plugin) => plugin.decorations,
    })
    const languageExtensions = editorLanguage === 'typst'
      ? [
          typst(),
          codeFolding(),
          foldGutter(),
          foldService.of(typstFoldService),
          autocompletion({
            override: [
              (context) => typstPathCompletion(context, currentFilePathRef.current, projectFilesRef.current),
              (context) => typstPackageCompletion(context, packageSuggestionsRef.current),
              (context) => typstReferenceCompletion(context, assistDataRef.current.typstReferenceOptions),
              (context) => typstHashCommandCompletion(context, assistDataRef.current.typstHashCommandOptions),
            ],
            activateOnTyping: true,
          }),
        ]
      : editorLanguage === 'latex'
        ? [
            codeFolding(),
            foldGutter(),
            foldService.of(latexFoldService),
            autocompletion({
              override: [
                (context) => latexCommandCompletion(context),
                (context) => latexEnvironmentCompletion(context),
                (context) => latexReferenceCompletion(context, assistDataRef.current.latexReferenceOptions),
                (context) => latexCitationCompletion(context, assistDataRef.current.latexCitationOptions),
                (context) => latexPathCompletion(context, currentFilePathRef.current, projectFilesRef.current),
                (context) => latexPackageCompletion(context),
              ],
              activateOnTyping: true,
            }),
            latexSyntaxDecorations,
          ]
        : []

    const state = EditorState.create({
      doc: ytext.toString(),
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        syntaxThemeCompartmentRef.current.of(buildSyntaxThemeExtension(editorMode)),
        search({ top: true }),
        ...languageExtensions,
        yCollab(ytext, awareness, { undoManager }),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        suggestionField,
        suggestionViewPlugin,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...searchKeymap,
          ...foldKeymap,
          {
            key: 'Mod-i',
            run: () => { setShowGemini(true); return true },
          },
          {
            key: 'Tab',
            run: (view) => {
              const suggestion = view.state.field(suggestionField)
              if (suggestion) {
                const pos = view.state.selection.main.head
                // Use ytext to insert for collaboration
                ytext.insert(pos, suggestion)
                view.dispatch({
                  effects: setSuggestionEffect.of(null),
                  selection: EditorSelection.cursor(pos + suggestion.length)
                })
                return true
              }
              return false
            }
          },
          {
            key: 'Escape',
            run: (view) => {
              if (view.state.field(suggestionField)) {
                view.dispatch({ effects: setSuggestionEffect.of(null) })
                return true
              }
              return false
            }
          },
          ...buildShortcutKeyBindings(shortcutBindings, {
            compile: () => { onCompileRef.current?.(); return true },
            save: () => { onSaveRef.current?.(); return true },
            search: () => { onOpenSearchRef.current?.(); return true },
            projectSearch: () => { onOpenProjectSearchRef.current?.(); return true },
            toggleNavigation: () => { onToggleNavigationRef.current?.(); return true },
            quickExport: () => { onQuickExportRef.current?.(); return true },
            insertCite: (view) => {
              const range = view.state.selection.main
              const selectedText = range.from !== range.to
                ? view.state.sliceDoc(range.from, range.to).trim()
                : ''
              const coords = view.coordsAtPos(range.head)
              const anchorRect = coords ? new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top) : null
              citeShortcutModeRef.current = true
              onCiteSearchRef.current?.(selectedText, anchorRect, true)
              return true
            },
            previousSection: jumpToPreviousSection,
            nextSection: jumpToNextSection,
            toggleFold: (view) => toggleFold(view),
            togglePreview: () => { onTogglePreviewRef.current?.(); return true },
            focusEditor: () => { onFocusEditorRef.current?.(); return true },
          }),
        ]),
        editorThemeCompartmentRef.current.of(buildEditorViewTheme(editorMode, fontFamily, fontSize)),
        EditorView.lineWrapping,
        // Fire onChange on every document change (local or remote Y.js)
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current?.(update.state.doc.toString())
          }

          const isLocalUserEdit = update.transactions.some((transaction) => {
            if (!transaction.docChanged) {
              return false
            }

            const userEvent = transaction.annotation(Transaction.userEvent)
            return typeof userEvent === 'string' && userEvent.length > 0
          })

          if (isLocalUserEdit) {
            if (onLocalEditRef.current) {
              onLocalEditRef.current?.(update.startState.doc.toString(), update.state.doc.toString())
            }

            // Suggestion logic
            if (isCoAuthorEnabledRef.current && !readOnly) {
              clearTimeout(suggestionTimeoutRef.current)
              suggestionTimeoutRef.current = setTimeout(async () => {
                const view = viewRef.current
                if (!view) return
                const state = view.state
                const pos = state.selection.main.head
                const before = state.doc.sliceString(0, pos)
                
                if (before.length > 0 && !/[\s\n]$/.test(before)) return

                try {
                  const context = `The following is a ${editorLanguage} document. Suggest the next few words or sentences to complete the current thought. Provide ONLY the suggested completion text, no explanation.\n\nDocument so far:\n${before}`
                  // projectId is available in this scope from props
                  const suggestion = await gemini.generate('Continue writing...', context, projectId)
                  
                  if (viewRef.current === view) {
                    view.dispatch({
                      effects: setSuggestionEffect.of(suggestion.trim())
                    })
                  }
                } catch (e) {
                  console.error('Gemini co-author error:', e)
                }
              }, 5000)
            }
          }

          if (update.docChanged || update.selectionSet) {
            const head = update.state.selection.main.head
            const line = update.state.doc.lineAt(head)
            if (awarenessCursorTimerRef.current !== null) {
              window.clearTimeout(awarenessCursorTimerRef.current)
            }
            awarenessCursorTimerRef.current = window.setTimeout(() => {
              awarenessCursorTimerRef.current = null
              awareness.setLocalStateField('typstrCursor', {
                filePath: currentFilePathRef.current ?? null,
                line: line.number,
                column: head - line.from + 1,
              })
            }, 150)
            onCursorLocationChangeRef.current?.({
              line: line.number,
              column: head - line.from + 1,
            })
            onSelectionRangeChangeRef.current?.(selectionToCommentAnchor(update.state))
            if (signatureTooltipTimerRef.current !== null) {
              window.clearTimeout(signatureTooltipTimerRef.current)
            }
            signatureTooltipTimerRef.current = window.setTimeout(() => {
              signatureTooltipTimerRef.current = null
              const nextTip = computeSignatureTooltip(update.view, assistDataRef.current.docLookup, wrapperRef.current)
              setSignatureTooltipState((prev) => {
                if (!prev && !nextTip) return prev
                if (prev && nextTip && prev.entry.label === nextTip.entry.label && prev.activeParameter === nextTip.activeParameter) {
                  return prev
                }
                return nextTip
              })
            }, 150)

            // Cite-search popup trigger
            if (onCiteSearchRef.current || onCiteSearchCloseRef.current) {
              if (citeShortcutModeRef.current) {
                // Shortcut-opened popup: don't auto-close on cursor movement
              } else {
                const before = update.state.doc.sliceString(0, head)
                const latexMatch = editorLanguage === 'latex'
                  ? before.match(/\\(?:cite|citep|citet|textcite|parencite|autocite)\*?\{([^}]*)$/)
                  : null
                // Only trigger Typst cite popup when @ is followed by at least 1 word char
                const typstMatch = editorLanguage === 'typst'
                  ? before.match(/@([\w][\w-]*)$/)
                  : null
                const citeMatch = latexMatch ?? typstMatch
                if (citeMatch) {
                  const query = (citeMatch[1] ?? '').split(',').pop()?.trim() ?? ''
                  const coords = update.view.coordsAtPos(head)
                  const anchorRect = coords
                    ? new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top)
                    : null
                  onCiteSearchRef.current?.(query, anchorRect, false, citeMatch[0].length)
                } else {
                  onCiteSearchCloseRef.current?.()
                }
              }
            }
          }
        }),
        commentDecorations,
        aiEditDecorations,
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    const head = view.state.selection.main.head
    const line = view.state.doc.lineAt(head)
    awareness.setLocalStateField('typstrCursor', {
      filePath: currentFilePathRef.current ?? null,
      line: line.number,
      column: head - line.from + 1,
    })
    onCursorLocationChangeRef.current?.({ line: line.number, column: head - line.from + 1 })
    onSelectionRangeChangeRef.current?.(selectionToCommentAnchor(view.state))
    setSignatureTooltipState(computeSignatureTooltip(view, assistDataRef.current.docLookup, wrapperRef.current))

    const handleMouseMove = (event: MouseEvent) => {
      if (hoverTooltipFrameRef.current !== null) {
        cancelAnimationFrame(hoverTooltipFrameRef.current)
      }

      hoverTooltipFrameRef.current = requestAnimationFrame(() => {
        hoverTooltipFrameRef.current = null
        const nextTooltip = computeHoverTooltip(view, event, assistDataRef.current.docLookup, commentLookupRef.current, wrapperRef.current)
        setHoverTooltipState(nextTooltip)
      })
    }

    const handleMouseLeave = () => {
      if (hoverTooltipFrameRef.current !== null) {
        cancelAnimationFrame(hoverTooltipFrameRef.current)
        hoverTooltipFrameRef.current = null
      }
      setHoverTooltipState(null)
    }

    const handleClick = (event: MouseEvent) => {
      const aiEditTarget = event.target instanceof Element ? event.target.closest('[data-ai-edit-action]') : null
      const aiEditId = aiEditTarget?.getAttribute('data-ai-edit-id')
      const aiEditAction = aiEditTarget?.getAttribute('data-ai-edit-action')
      if (aiEditId && (aiEditAction === 'accept' || aiEditAction === 'reject')) {
        event.preventDefault()
        event.stopPropagation()
        onAiEditDecisionRef.current?.(aiEditId, aiEditAction)
        return
      }

      const target = event.target instanceof Element ? event.target.closest('[data-comment-id]') : null
      const commentId = target?.getAttribute('data-comment-id')
      if (!commentId) {
        return
      }

      event.stopPropagation()
      onCommentActivateRef.current?.(commentId)
    }

    const handleDoubleClick = () => {
      const selection = selectionToCommentAnchor(view.state)
      if (!selection) {
        return
      }

      onSelectionRangeChangeRef.current?.(selection)
      onStartCommentFromSelectionRef.current?.(selection)
    }

    const handlePaste = (event: ClipboardEvent) => {
      if (readOnly || (editorLanguage !== 'typst' && editorLanguage !== 'latex')) {
        return
      }

      const pastedText = event.clipboardData?.getData('text/plain')?.trim()
      if (!pastedText || !isCitationIdentifierText(pastedText)) {
        return
      }

      const resolver = onResolveCitationIdentifierRef.current
      if (!resolver) {
        return
      }

      event.preventDefault()
      void resolver(pastedText).then((key) => {
        if (!key || viewRef.current !== view) {
          return
        }

        const selection = view.state.selection.main
        const insert = editorLanguage === 'latex' ? `\\cite{${key}}` : `@${key}`
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert },
          selection: EditorSelection.cursor(selection.from + insert.length),
          scrollIntoView: true,
        })
        view.focus()
      }).catch(() => {
        if (viewRef.current !== view) {
          return
        }

        const selection = view.state.selection.main
        view.dispatch({
          changes: { from: selection.from, to: selection.to, insert: pastedText },
          selection: EditorSelection.cursor(selection.from + pastedText.length),
          scrollIntoView: true,
        })
      })
    }

    view.dom.addEventListener('mousemove', handleMouseMove)
    view.dom.addEventListener('mouseleave', handleMouseLeave)
    view.dom.addEventListener('click', handleClick)
    view.dom.addEventListener('dblclick', handleDoubleClick)
    view.dom.addEventListener('paste', handlePaste)

    return () => {
      if (hoverTooltipFrameRef.current !== null) {
        cancelAnimationFrame(hoverTooltipFrameRef.current)
        hoverTooltipFrameRef.current = null
      }
      view.dom.removeEventListener('mousemove', handleMouseMove)
      view.dom.removeEventListener('mouseleave', handleMouseLeave)
      view.dom.removeEventListener('click', handleClick)
      view.dom.removeEventListener('dblclick', handleDoubleClick)
      view.dom.removeEventListener('paste', handlePaste)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awareness, editorLanguage, projectId, readOnly, shortcutBindings, ytext])

  useEffect(() => {
    onSignatureHelpChangeRef.current?.(signatureTooltipState
      ? {
          label: signatureTooltipState.entry.label,
          summary: signatureTooltipState.entry.summary,
          signature: signatureTooltipState.entry.signature,
          parameters: signatureTooltipState.entry.parameters,
          activeParameter: signatureTooltipState.activeParameter,
        }
      : null)
  }, [signatureTooltipState])

  return (
    <div ref={wrapperRef} style={{ height: '100%', overflow: 'hidden', position: 'relative' }}>
      {aiEditSuggestions.length > 0 ? (
        <div className={styles.aiEditToolbar}>
          <span>{aiEditSuggestions.length} AI edit{aiEditSuggestions.length === 1 ? '' : 's'}</span>
          <button
            className={styles.aiEditAcceptBtn}
            onClick={() => onAiEditBulkDecision?.('accept')}
            title="Accept all AI edits"
            aria-label="Accept all AI edits"
          >
            <Check size={15} aria-hidden />
          </button>
          <button
            className={styles.aiEditRejectBtn}
            onClick={() => onAiEditBulkDecision?.('reject')}
            title="Reject all AI edits"
            aria-label="Reject all AI edits"
          >
            <X size={15} aria-hidden />
          </button>
        </div>
      ) : null}
      {showGemini && (
        <GeminiPromptDialog
          loading={gemini.loading}
          onClose={() => setShowGemini(false)}
          onConfirm={async (prompt) => {
            const view = viewRef.current
            if (!view) return
            try {
              const result = await gemini.generate(prompt, view.state.doc.toString())
              const sel = view.state.selection.main
              // Use Yjs directly to ensure undo/redo compatibility and synchronization
              ytext.delete(sel.from, sel.to - sel.from)
              ytext.insert(sel.from, result)
              setShowGemini(false)
            } catch (e) {
              console.error(e)
            }
          }}
        />
      )}
      <div
        ref={containerRef}
        style={{ height: '100%', overflow: 'hidden' }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && ['s', 'enter', 'g', 'p', 'f', 'b', 'o', 'e'].includes(e.key.toLowerCase())) {
            return
          }
          e.stopPropagation()
        }}
        onInput={(e) => e.stopPropagation()}
        onMouseDown={(e) => {
          e.stopPropagation()
        }}
      />

      {hoverTooltipState ? (
        <EditorAssistTooltip tooltip={hoverTooltipState} />
      ) : null}

      {signatureTooltipState ? (
        <EditorAssistTooltip tooltip={signatureTooltipState} />
      ) : null}
    </div>
  )
}

function buildSyntaxThemeExtension(editorMode: 'dark' | 'light') {
  return editorMode === 'dark'
    ? [oneDark, syntaxHighlighting(DARK_HIGHLIGHT_STYLE)]
    : [syntaxHighlighting(LIGHT_HIGHLIGHT_STYLE)]
}

function buildEditorViewTheme(editorMode: 'dark' | 'light', fontFamily: string, fontSize: number) {
  const colors = editorMode === 'dark' ? DARK_EDITOR_COLORS : LIGHT_EDITOR_COLORS

  return EditorView.theme({
    '&': {
      height: '100%',
      fontSize: `${fontSize}px`,
      backgroundColor: colors.background,
      color: colors.text,
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily,
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: colors.caret,
    },
    '.cm-activeLine, .cm-activeLineGutter': {
      backgroundColor: 'var(--row-hover)',
    },
    '.cm-selectionBackground': {
      backgroundColor: colors.selection,
    },
    '.cm-content, .cm-gutters': {
      backgroundColor: colors.background,
      color: colors.text,
    },
    '.cm-gutters': {
      borderRight: `1px solid ${colors.border}`,
      color: colors.gutterText,
    },
    '.cm-commentRange': {
      backgroundColor: 'var(--warning-bg)',
      borderRadius: '3px',
    },
    '.cm-commentRangeActive': {
      backgroundColor: 'var(--active-bg)',
      outline: '1px solid var(--accent)',
      outlineOffset: '1px',
    },
    '.cm-commentMarker': {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '18px',
      height: '16px',
      padding: '0 4px',
      marginLeft: '4px',
      borderRadius: '999px',
      fontSize: '10px',
      fontWeight: '700',
      lineHeight: '1',
      backgroundColor: 'var(--action-bg)',
      color: 'var(--accent)',
    },
    '.cm-aiEditRange': {
      borderRadius: '4px',
      backgroundColor: 'color-mix(in srgb, var(--success) 14%, transparent)',
      boxShadow: 'inset 0 -1px 0 color-mix(in srgb, var(--success) 60%, transparent)',
    },
    '.cm-aiEditRangeDelete': {
      backgroundColor: 'color-mix(in srgb, var(--danger) 14%, transparent)',
      boxShadow: 'inset 0 -1px 0 color-mix(in srgb, var(--danger) 60%, transparent)',
      textDecoration: 'line-through',
      textDecorationColor: 'var(--danger)',
    },
    '.cm-aiEditWidget': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      marginLeft: '6px',
      verticalAlign: 'middle',
    },
    '.cm-aiEditPreview': {
      maxWidth: '260px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      borderRadius: '6px',
      padding: '1px 6px',
      backgroundColor: 'var(--success-bg)',
      color: 'var(--success)',
      fontSize: '11px',
      fontWeight: '600',
    },
    '.cm-aiEditButton': {
      width: '20px',
      height: '20px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
      borderRadius: '999px',
      border: '1px solid currentColor',
      backgroundColor: 'var(--card-bg)',
      fontSize: '13px',
      fontWeight: '800',
      lineHeight: '1',
      cursor: 'pointer',
    },
    '.cm-aiEditAccept': {
      color: 'var(--success)',
    },
    '.cm-aiEditReject': {
      color: 'var(--danger)',
    },
    '.cm-latexCommand': {
      color: 'var(--accent)',
      fontWeight: 600,
    },
    '.cm-latexComment': {
      color: 'var(--muted-text)',
      fontStyle: 'italic',
    },
    '.cm-latexMath': {
      color: 'var(--warning)',
    },
    '.cm-latexBrace': {
      color: 'var(--text-soft)',
    },
    '&.cm-focused': {
      outline: 'none',
    },
  }, { dark: editorMode === 'dark' })
}

class SuggestionWidget extends WidgetType {
  readonly text: string
  constructor(text: string) {
    super()
    this.text = text
  }
  eq(other: SuggestionWidget) { return this.text === other.text }
  toDOM() {
    const span = document.createElement('span')
    span.style.color = 'var(--muted-text)'
    span.style.fontStyle = 'italic'
    span.style.pointerEvents = 'none'
    span.style.opacity = '0.6'
    span.textContent = this.text
    return span
  }
}

const suggestionViewPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view)
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.effects.some(e => e.is(setSuggestionEffect)))) {
      this.decorations = this.buildDecorations(update.view)
    }
  }
  buildDecorations(view: EditorView) {
    const suggestion = view.state.field(suggestionField)
    if (!suggestion || !view.state.selection.main.empty) return Decoration.none
    const pos = view.state.selection.main.head
    return Decoration.set([
      Decoration.widget({
        widget: new SuggestionWidget(suggestion),
        side: 1,
      }).range(pos)
    ])
  }
}, {
  decorations: v => v.decorations
})

class CommentMarkerWidget extends WidgetType {
  private readonly commentId: string
  private readonly isActive: boolean

  constructor(commentId: string, isActive: boolean) {
    super()
    this.commentId = commentId
    this.isActive = isActive
  }

  eq(other: CommentMarkerWidget) {
    return this.commentId === other.commentId && this.isActive === other.isActive
  }

  toDOM() {
    const marker = document.createElement('span')
    marker.className = 'cm-commentMarker'
    marker.dataset.commentId = this.commentId
    marker.textContent = this.isActive ? 'OPEN' : 'NOTE'
    return marker
  }
}

class AiEditWidget extends WidgetType {
  private readonly edit: AiEditSuggestion

  constructor(edit: AiEditSuggestion) {
    super()
    this.edit = edit
  }

  eq(other: AiEditWidget) {
    return this.edit.id === other.edit.id
      && this.edit.replacementText === other.edit.replacementText
      && this.edit.kind === other.edit.kind
  }

  toDOM() {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-aiEditWidget'

    if (this.edit.replacementText) {
      const preview = document.createElement('span')
      preview.className = 'cm-aiEditPreview'
      preview.textContent = this.edit.kind === 'insert'
        ? this.edit.replacementText
        : `→ ${this.edit.replacementText}`
      wrapper.appendChild(preview)
    }

    const accept = document.createElement('button')
    accept.type = 'button'
    accept.className = 'cm-aiEditButton cm-aiEditAccept'
    accept.dataset.aiEditId = this.edit.id
    accept.dataset.aiEditAction = 'accept'
    accept.title = 'Accept AI edit'
    accept.setAttribute('aria-label', 'Accept AI edit')
    accept.textContent = '✓'
    wrapper.appendChild(accept)

    const reject = document.createElement('button')
    reject.type = 'button'
    reject.className = 'cm-aiEditButton cm-aiEditReject'
    reject.dataset.aiEditId = this.edit.id
    reject.dataset.aiEditAction = 'reject'
    reject.title = 'Reject AI edit'
    reject.setAttribute('aria-label', 'Reject AI edit')
    reject.textContent = '×'
    wrapper.appendChild(reject)

    return wrapper
  }
}

function buildCommentDecorations(view: EditorView, comments: ProjectComment[], highlightedCommentId: string | null) {
  const builder = new RangeSetBuilder<Decoration>()

  for (const comment of comments) {
    if (comment.status === 'deleted') {
      continue
    }

    const from = lineColumnToOffset(view.state, comment.startLine, comment.startColumn)
    const rawTo = lineColumnToOffset(view.state, comment.endLine, comment.endColumn)
    const to = rawTo > from ? rawTo : Math.min(view.state.doc.length, from + 1)
    const className = comment.id === highlightedCommentId ? 'cm-commentRange cm-commentRangeActive' : 'cm-commentRange'

    builder.add(from, to, Decoration.mark({ class: className, attributes: { 'data-comment-id': comment.id } }))
    builder.add(to, to, Decoration.widget({ widget: new CommentMarkerWidget(comment.id, comment.id === highlightedCommentId), side: 1 }))
  }

  return builder.finish()
}

function buildAiEditDecorations(view: EditorView, edits: AiEditSuggestion[]) {
  const builder = new RangeSetBuilder<Decoration>()
  let source: string | null = null
  const getSource = () => {
    source ??= view.state.doc.toString()
    return source
  }
  const ordered = edits
    .filter((edit) => edit.to >= edit.from)
    .map((edit) => ({ edit, range: resolveAiEditDecorationRange(view, edit, getSource) }))
    .sort((left, right) => left.range.from - right.range.from || left.range.to - right.range.to)

  // Skip ranges that overlap an already-added one. This can happen during the
  // brief window after an AI edit is accepted: the y-codemirror binding fires
  // a doc-change transaction synchronously, which rebuilds decorations using
  // the still-stale `aiEditSuggestionsRef`. The just-accepted edit's
  // `originalText` is no longer at its original offset, so the fallback
  // global search can resolve it into a range overlapping another edit's
  // range. Feeding overlapping ranges to `RangeSetBuilder.add` throws and
  // tears down the entire decoration plugin, hiding *all* AI-edit widgets
  // until the next refresh.
  let lastAddedTo = -1
  for (const { edit, range } of ordered) {
    if (range.from < lastAddedTo) {
      continue
    }
    const { from, to } = range
    if (to > from) {
      const className = edit.kind === 'delete'
        ? 'cm-aiEditRange cm-aiEditRangeDelete'
        : 'cm-aiEditRange'
      builder.add(from, to, Decoration.mark({ class: className }))
    }
    builder.add(to, to, Decoration.widget({ widget: new AiEditWidget(edit), side: -1 }))
    lastAddedTo = to
  }

  return builder.finish()
}

function resolveAiEditDecorationRange(view: EditorView, edit: AiEditSuggestion, getSource: () => string): { from: number; to: number } {
  const length = view.state.doc.length
  const boundedFrom = Math.min(Math.max(0, edit.from), length)
  const boundedTo = Math.min(Math.max(boundedFrom, edit.to), length)
  if (view.state.doc.sliceString(boundedFrom, boundedTo) === edit.originalText) {
    return { from: boundedFrom, to: boundedTo }
  }

  if (edit.originalText) {
    const source = getSource()
    const nearbyStart = Math.max(0, boundedFrom - 500)
    const nearbyEnd = Math.min(length, boundedTo + 500)
    const nearbyIndex = source.slice(nearbyStart, nearbyEnd).indexOf(edit.originalText)
    if (nearbyIndex !== -1) {
      const from = nearbyStart + nearbyIndex
      return { from, to: from + edit.originalText.length }
    }

    const globalIndex = source.indexOf(edit.originalText)
    if (globalIndex !== -1) {
      return { from: globalIndex, to: globalIndex + edit.originalText.length }
    }
  }

  return { from: boundedFrom, to: boundedTo }
}

function lineColumnToOffset(state: EditorState, lineNumber: number, column: number) {
  const safeLineNumber = Math.min(Math.max(1, lineNumber), state.doc.lines)
  const line = state.doc.line(safeLineNumber)
  const maxColumn = line.length + 1
  const safeColumn = Math.min(Math.max(1, column), maxColumn)
  return Math.min(line.from + safeColumn - 1, state.doc.length)
}

function selectionToCommentAnchor(state: EditorState): CommentSelectionAnchor | null {
  const selection = state.selection.main
  if (selection.empty) {
    return null
  }

  const start = state.doc.lineAt(selection.from)
  const end = state.doc.lineAt(selection.to)
  const excerpt = state.sliceDoc(selection.from, selection.to).replace(/\s+/g, ' ').trim().slice(0, 160)

  if (!excerpt) {
    return null
  }

  return {
    excerpt,
    startLine: start.number,
    startColumn: selection.from - start.from + 1,
    endLine: end.number,
    endColumn: selection.to - end.from + 1,
  }
}

const TYPST_HASH_COMMANDS: Completion[] = [
  { label: 'let', type: 'keyword', detail: 'Bind a value', apply: 'let name = ' },
  { label: 'set', type: 'keyword', detail: 'Set a style rule', apply: 'set text(size: 11pt)' },
  { label: 'show', type: 'keyword', detail: 'Show rule', apply: 'show heading: set text(weight: "bold")' },
  { label: 'if', type: 'keyword', detail: 'Conditional block', apply: 'if condition {\n  \n}' },
  { label: 'for', type: 'keyword', detail: 'Loop block', apply: 'for item in items {\n  \n}' },
  { label: 'import', type: 'keyword', detail: 'Import a Typst module or package', apply: 'import "": *' },
  { label: 'include', type: 'keyword', detail: 'Include another Typst file', apply: 'include ""' },
  { label: 'image', type: 'function', detail: 'Insert an image asset', apply: 'image("", width: 80%)' },
  { label: 'figure', type: 'function', detail: 'Figure with caption', apply: 'figure(\n  image("", width: 80%),\n  caption: [Caption],\n)' },
  { label: 'table', type: 'function', detail: 'Table skeleton', apply: 'table(\n  columns: 2,\n  [Left], [Right],\n)' },
  { label: 'align', type: 'function', detail: 'Alignment wrapper', apply: 'align(center)[\n  \n]' },
  { label: 'pagebreak', type: 'function', detail: 'Page break', apply: 'pagebreak()' },
  { label: 'bibliography', type: 'function', detail: 'Load a bibliography file', apply: 'bibliography("references.bib")' },
  { label: 'cite', type: 'function', detail: 'Citation helper', apply: 'cite(<key>)' },
  { label: 'ref', type: 'function', detail: 'Reference a label', apply: 'ref(<label>)' },
  { label: 'link', type: 'function', detail: 'Create a link', apply: 'link("https://example.com")[Label]' },
  { label: 'heading', type: 'function', detail: 'Construct a heading explicitly', apply: 'heading(level: 1)[Title]' },
  { label: 'raw', type: 'function', detail: 'Raw block', apply: 'raw(``\n\n``)' },
]

const TYPST_BUILTIN_FUNCTIONS: Completion[] = [
  { label: 'text', type: 'function', detail: 'Text styling function', apply: 'text(size: 11pt)[' },
  { label: 'strong', type: 'function', detail: 'Bold content', apply: 'strong[' },
  { label: 'emph', type: 'function', detail: 'Italic content', apply: 'emph[' },
  { label: 'list', type: 'function', detail: 'Bullet list', apply: 'list(\n  [Item],\n)' },
  { label: 'enum', type: 'function', detail: 'Numbered list', apply: 'enum(\n  [Item],\n)' },
  { label: 'grid', type: 'function', detail: 'Grid layout', apply: 'grid(columns: 2,\n  [Left], [Right],\n)' },
  { label: 'stack', type: 'function', detail: 'Stack layout', apply: 'stack(dir: ttb,\n  [Item],\n)' },
  { label: 'place', type: 'function', detail: 'Absolute placement', apply: 'place(top + right)[' },
  { label: 'box', type: 'function', detail: 'Box container', apply: 'box(stroke: 1pt + black)[' },
  { label: 'block', type: 'function', detail: 'Block container', apply: 'block(width: 100%)[\n  \n]' },
  { label: 'page', type: 'function', detail: 'Page configuration', apply: 'page(margin: 1in)' },
  { label: 'par', type: 'function', detail: 'Paragraph settings', apply: 'par(justify: true)' },
  { label: 'math.equation', type: 'function', detail: 'Math equation block', apply: 'math.equation($x + y$)' },
]

const TYPST_PACKAGE_SUGGESTIONS: Completion[] = [
  { label: '@preview/cetz:0.4.2', type: 'module', detail: 'Diagrams and vector graphics' },
  { label: '@preview/cetz-plot:0.1.3', type: 'module', detail: 'Data plotting and visualization' },
  { label: '@preview/fletcher:0.5.8', type: 'module', detail: 'Commutative diagrams' },
  { label: '@preview/glossarium:0.5.4', type: 'module', detail: 'Glossaries and acronym lists' },
  { label: '@preview/physica:0.9.5', type: 'module', detail: 'Physics notation helpers' },
  { label: '@preview/touying:0.6.1', type: 'module', detail: 'Slides and presentations' },
  { label: '@preview/tablex:0.0.9', type: 'module', detail: 'Advanced table utilities' },
  { label: '@preview/codly:1.3.0', type: 'module', detail: 'Code blocks and listings' },
]

const TYPST_DOC_ENTRIES: TypstDocEntry[] = [
  {
    label: 'text',
    kind: 'function',
    summary: 'Styles and lays out inline text content.',
    signature: 'text(fill: auto, size: auto, weight: auto, style: auto)[body]',
    parameters: ['fill', 'size', 'weight', 'style', 'body'],
  },
  {
    label: 'figure',
    kind: 'function',
    summary: 'Wraps content with figure semantics, captioning, and numbering.',
    signature: 'figure(body, caption: none, kind: auto, supplement: auto)',
    parameters: ['body', 'caption', 'kind', 'supplement'],
  },
  {
    label: 'image',
    kind: 'function',
    summary: 'Embeds an image asset from the project workspace or a URL.',
    signature: 'image(path, width: auto, height: auto, fit: "contain")',
    parameters: ['path', 'width', 'height', 'fit'],
  },
  {
    label: 'table',
    kind: 'function',
    summary: 'Creates a table with explicit columns and cell content.',
    signature: 'table(columns:, rows: auto, inset: auto, stroke: auto, ..cells)',
    parameters: ['columns', 'rows', 'inset', 'stroke', 'cells'],
  },
  {
    label: 'align',
    kind: 'function',
    summary: 'Aligns block content within the available layout region.',
    signature: 'align(alignment)[body]',
    parameters: ['alignment', 'body'],
  },
  {
    label: 'bibliography',
    kind: 'function',
    summary: 'Loads bibliography data and formatting for citations.',
    signature: 'bibliography(path, style: auto, title: auto)',
    parameters: ['path', 'style', 'title'],
  },
  {
    label: 'cite',
    kind: 'function',
    summary: 'Inserts a citation referencing one or more bibliography keys.',
    signature: 'cite(key, form: auto, supplement: auto)',
    parameters: ['key', 'form', 'supplement'],
  },
  {
    label: 'ref',
    kind: 'function',
    summary: 'References a label anchored elsewhere in the document.',
    signature: 'ref(target, form: auto, supplement: auto)',
    parameters: ['target', 'form', 'supplement'],
  },
  {
    label: 'grid',
    kind: 'function',
    summary: 'Builds a grid layout for structured page regions.',
    signature: 'grid(columns:, rows: auto, gutter: auto, ..children)',
    parameters: ['columns', 'rows', 'gutter', 'children'],
  },
  {
    label: 'stack',
    kind: 'function',
    summary: 'Stacks items horizontally or vertically with spacing control.',
    signature: 'stack(dir: ttb, spacing: auto, ..children)',
    parameters: ['dir', 'spacing', 'children'],
  },
  {
    label: 'place',
    kind: 'function',
    summary: 'Places content relative to a page or container edge.',
    signature: 'place(alignment, dx: 0pt, dy: 0pt)[body]',
    parameters: ['alignment', 'dx', 'dy', 'body'],
  },
  {
    label: 'page',
    kind: 'function',
    summary: 'Configures page size, margins, numbering, and header/footer behavior.',
    signature: 'page(width: auto, height: auto, margin: auto, numbering: none)',
    parameters: ['width', 'height', 'margin', 'numbering'],
  },
  {
    label: 'par',
    kind: 'function',
    summary: 'Controls paragraph-level layout and justification.',
    signature: 'par(justify: auto, first-line-indent: auto, leading: auto)',
    parameters: ['justify', 'first-line-indent', 'leading'],
  },
  {
    label: 'link',
    kind: 'function',
    summary: 'Creates a hyperlink around inline or block content.',
    signature: 'link(dest)[body]',
    parameters: ['dest', 'body'],
  },
  {
    label: 'heading',
    kind: 'function',
    summary: 'Constructs or styles a heading with level and numbering metadata.',
    signature: 'heading(level: 1, numbering: auto)[body]',
    parameters: ['level', 'numbering', 'body'],
  },
  {
    label: 'let',
    kind: 'keyword',
    summary: 'Binds a value or defines a reusable function in Typst.',
    signature: 'let name = value | let name(args) = body',
  },
  {
    label: 'set',
    kind: 'keyword',
    summary: 'Applies a style rule globally for subsequent matching content.',
    signature: 'set target(property: value)',
  },
  {
    label: 'show',
    kind: 'keyword',
    summary: 'Overrides how matching content renders, often for custom formatting.',
    signature: 'show selector: replacement',
  },
]

const LATEX_COMMAND_COMPLETIONS: Completion[] = [
  { label: 'documentclass', type: 'keyword', detail: 'Define document class', apply: 'documentclass{article}' },
  { label: 'usepackage', type: 'keyword', detail: 'Import package', apply: 'usepackage{}' },
  { label: 'title', type: 'keyword', detail: 'Document title', apply: 'title{}' },
  { label: 'author', type: 'keyword', detail: 'Document author', apply: 'author{}' },
  { label: 'date', type: 'keyword', detail: 'Document date', apply: 'date{}' },
  { label: 'maketitle', type: 'keyword', detail: 'Render title block', apply: 'maketitle' },
  { label: 'tableofcontents', type: 'keyword', detail: 'Insert table of contents', apply: 'tableofcontents' },
  { label: 'part', type: 'keyword', detail: 'Part heading', apply: 'part{}' },
  { label: 'chapter', type: 'keyword', detail: 'Chapter heading', apply: 'chapter{}' },
  { label: 'section', type: 'keyword', detail: 'Section heading', apply: 'section{}' },
  { label: 'subsection', type: 'keyword', detail: 'Subsection heading', apply: 'subsection{}' },
  { label: 'subsubsection', type: 'keyword', detail: 'Sub-subsection heading', apply: 'subsubsection{}' },
  { label: 'paragraph', type: 'keyword', detail: 'Paragraph heading', apply: 'paragraph{}' },
  { label: 'textbf', type: 'function', detail: 'Bold text', apply: 'textbf{}' },
  { label: 'textit', type: 'function', detail: 'Italic text', apply: 'textit{}' },
  { label: 'emph', type: 'function', detail: 'Emphasized text', apply: 'emph{}' },
  { label: 'underline', type: 'function', detail: 'Underline text', apply: 'underline{}' },
  { label: 'label', type: 'keyword', detail: 'Create reference anchor', apply: 'label{}' },
  { label: 'ref', type: 'keyword', detail: 'Insert reference', apply: 'ref{}' },
  { label: 'eqref', type: 'keyword', detail: 'Equation reference', apply: 'eqref{}' },
  { label: 'pageref', type: 'keyword', detail: 'Page reference', apply: 'pageref{}' },
  { label: 'autoref', type: 'keyword', detail: 'Auto-prefixed reference', apply: 'autoref{}' },
  { label: 'cite', type: 'keyword', detail: 'Citation', apply: 'cite{}' },
  { label: 'textcite', type: 'keyword', detail: 'Text citation', apply: 'textcite{}' },
  { label: 'parencite', type: 'keyword', detail: 'Parenthetical citation', apply: 'parencite{}' },
  { label: 'begin', type: 'keyword', detail: 'Begin environment', apply: 'begin{}' },
  { label: 'end', type: 'keyword', detail: 'End environment', apply: 'end{}' },
  { label: 'item', type: 'keyword', detail: 'List item', apply: 'item ' },
  { label: 'includegraphics', type: 'function', detail: 'Insert image', apply: 'includegraphics[width=\\linewidth]{}' },
  { label: 'caption', type: 'keyword', detail: 'Caption text', apply: 'caption{}' },
  { label: 'centering', type: 'keyword', detail: 'Center content', apply: 'centering' },
  { label: 'input', type: 'keyword', detail: 'Input another .tex file', apply: 'input{}' },
  { label: 'include', type: 'keyword', detail: 'Include chapter file', apply: 'include{}' },
  { label: 'bibliography', type: 'keyword', detail: 'BibTeX bibliography file', apply: 'bibliography{}' },
  { label: 'addbibresource', type: 'keyword', detail: 'biblatex resource', apply: 'addbibresource{}' },
  { label: 'printbibliography', type: 'keyword', detail: 'Render bibliography', apply: 'printbibliography' },
  { label: 'frac', type: 'function', detail: 'Fraction', apply: 'frac{}{}' },
  { label: 'sqrt', type: 'function', detail: 'Square root', apply: 'sqrt{}' },
  { label: 'sum', type: 'function', detail: 'Summation', apply: 'sum_{i=1}^{n}' },
  { label: 'int', type: 'function', detail: 'Integral', apply: 'int_{a}^{b}' },
  { label: 'alpha', type: 'constant', detail: 'Greek alpha', apply: 'alpha' },
  { label: 'beta', type: 'constant', detail: 'Greek beta', apply: 'beta' },
  { label: 'gamma', type: 'constant', detail: 'Greek gamma', apply: 'gamma' },
  { label: 'rightarrow', type: 'constant', detail: 'Right arrow', apply: 'rightarrow' },
]

const LATEX_ENVIRONMENTS = [
  'document',
  'abstract',
  'itemize',
  'enumerate',
  'description',
  'figure',
  'table',
  'tabular',
  'equation',
  'align',
  'align*',
  'gather',
  'gather*',
  'multline',
  'cases',
  'matrix',
  'pmatrix',
  'bmatrix',
  'vmatrix',
  'proof',
  'theorem',
  'lemma',
  'proposition',
  'corollary',
]

const LATEX_COMMON_PACKAGES = [
  'amsmath',
  'amssymb',
  'mathtools',
  'graphicx',
  'xcolor',
  'hyperref',
  'geometry',
  'booktabs',
  'biblatex',
  'csquotes',
  'cleveref',
  'siunitx',
  'tikz',
  'pgfplots',
  'enumitem',
  'microtype',
]

const LATEX_DOC_ENTRIES: TypstDocEntry[] = [
  {
    label: 'section',
    kind: 'keyword',
    summary: 'Creates a numbered section heading.',
    signature: '\\section{title}',
    parameters: ['title'],
  },
  {
    label: 'subsection',
    kind: 'keyword',
    summary: 'Creates a numbered subsection heading.',
    signature: '\\subsection{title}',
    parameters: ['title'],
  },
  {
    label: 'begin',
    kind: 'keyword',
    summary: 'Starts an environment block.',
    signature: '\\begin{environment} ... \\end{environment}',
    parameters: ['environment'],
  },
  {
    label: 'ref',
    kind: 'keyword',
    summary: 'References a \\label anchor.',
    signature: '\\ref{label}',
    parameters: ['label'],
  },
  {
    label: 'cite',
    kind: 'keyword',
    summary: 'Inserts a bibliography citation.',
    signature: '\\cite{key}',
    parameters: ['key'],
  },
  {
    label: 'includegraphics',
    kind: 'function',
    summary: 'Embeds an image file.',
    signature: '\\includegraphics[width=\\linewidth]{path}',
    parameters: ['width', 'path'],
  },
]

function typstHashCommandCompletion(
  context: CompletionContext,
  projectSymbolCompletions: Completion[] = [],
) {
  const match = context.matchBefore(/#[A-Za-z0-9_.-]*/)
  if (!match || (match.from === match.to && !context.explicit)) {
    return null
  }

  const current = match.text.slice(1).toLowerCase()
  const options = dedupeCompletions([
    ...TYPST_HASH_COMMANDS,
    ...TYPST_BUILTIN_FUNCTIONS,
    ...projectSymbolCompletions,
  ]).filter((command) => !current || command.label.toLowerCase().startsWith(current))

  return {
    from: match.from + 1,
    options,
  }
}

function typstPackageCompletion(context: CompletionContext, packageSuggestions: Array<{ label: string; detail: string }> = []) {
  const match = context.matchBefore(/#import\s+"[^"]*/)
  if (!match) {
    return null
  }

  const quoteIndex = match.text.lastIndexOf('"')
  if (quoteIndex === -1) {
    return null
  }

  const typed = match.text.slice(quoteIndex + 1).toLowerCase()
  const options = [...packageSuggestions.map((entry) => ({
    label: entry.label,
    type: 'module' as const,
    detail: entry.detail,
  })), ...TYPST_PACKAGE_SUGGESTIONS]
    .filter((entry) => !typed || entry.label.toLowerCase().startsWith(typed))
  return options.length ? { from: match.from + quoteIndex + 1, options } : null
}

function typstReferenceCompletion(
  context: CompletionContext,
  referenceCompletions: Completion[] = [],
) {
  const match = context.matchBefore(/@[^\n@{}()[\],;.]*/)
  if (!match || (match.from === match.to && !context.explicit)) {
    return null
  }

  const current = match.text.slice(1).trim().toLowerCase()
  const options = referenceCompletions.filter((entry) => citationCompletionMatches(entry, current))

  return options.length ? { from: match.from + 1, options } : null
}

function typstPathCompletion(
  context: CompletionContext,
  currentFilePath?: string,
  projectFiles: Array<{ path: string; mimeType: string }> = [],
) {
  const match = context.matchBefore(/(?:#include|#import|image)\(\s*"[^"]*/)
  if (!match) {
    return null
  }

  const quoteIndex = match.text.lastIndexOf('"')
  if (quoteIndex === -1) {
    return null
  }

  const typedPath = match.text.slice(quoteIndex + 1)
  const currentDir = currentFilePath ? currentFilePath.split('/').slice(0, -1).join('/') : ''
  const options = projectFiles
    .filter((file) => file.mimeType !== 'application/vnd.google-apps.folder')
    .map((file) => ({ path: toRelativePath(currentDir, file.path), mimeType: file.mimeType }))
    .filter((file) => !typedPath || file.path.startsWith(typedPath))
    .slice(0, 30)
    .map((file) => ({
      label: file.path,
      type: file.mimeType.startsWith('image/') ? 'file' as const : 'text' as const,
      detail: file.mimeType,
    }))

  return options.length ? { from: match.from + quoteIndex + 1, options } : null
}

function latexCommandCompletion(context: CompletionContext) {
  const match = context.matchBefore(/\\[A-Za-z@]*/)
  if (!match || (match.from === match.to && !context.explicit)) {
    return null
  }

  const query = match.text.slice(1).toLowerCase()
  const options = LATEX_COMMAND_COMPLETIONS
    .filter((entry) => !query || entry.label.toLowerCase().startsWith(query))
    .map((entry) => ({ ...entry }))

  return options.length ? { from: match.from + 1, options } : null
}

function latexEnvironmentCompletion(context: CompletionContext) {
  const match = context.matchBefore(/\\(?:begin|end)\{[^}]*/)
  if (!match) {
    return null
  }

  const braceIndex = match.text.lastIndexOf('{')
  if (braceIndex === -1) {
    return null
  }

  const query = match.text.slice(braceIndex + 1).toLowerCase()
  const options = LATEX_ENVIRONMENTS
    .filter((env) => !query || env.toLowerCase().startsWith(query))
    .map((env) => ({ label: env, type: 'keyword' as const, detail: 'LaTeX environment' }))
  return options.length ? { from: match.from + braceIndex + 1, options } : null
}

function latexReferenceCompletion(
  context: CompletionContext,
  labelCompletions: Completion[] = [],
) {
  const match = context.matchBefore(/\\(?:ref|eqref|autoref|pageref)\{[^}]*/)
  if (!match) {
    return null
  }

  const braceIndex = match.text.lastIndexOf('{')
  if (braceIndex === -1) {
    return null
  }

  const query = match.text.slice(braceIndex + 1).toLowerCase()
  const options = labelCompletions.filter((entry) => !query || entry.label.toLowerCase().includes(query))
  return options.length ? { from: match.from + braceIndex + 1, options } : null
}

function latexCitationCompletion(
  context: CompletionContext,
  citationCompletions: Completion[] = [],
) {
  const match = context.matchBefore(/\\(?:cite|citep|citet|textcite|parencite|autocite)\*?\{[^}]*/)
  if (!match) {
    return null
  }

  const braceIndex = match.text.lastIndexOf('{')
  if (braceIndex === -1) {
    return null
  }

  const query = match.text.slice(braceIndex + 1).toLowerCase().split(',').pop()?.trim() ?? ''
  const options = citationCompletions.filter((entry) => citationCompletionMatches(entry, query))
  return options.length ? { from: match.from + braceIndex + 1, options } : null
}

function citationCompletionMatches(entry: Completion, query: string): boolean {
  if (!query) {
    return true
  }

  const haystack = [
    entry.label,
    typeof entry.detail === 'string' ? entry.detail : '',
    typeof entry.info === 'string' ? entry.info : '',
  ].join(' ').toLowerCase()
  return query.split(/\s+/).every((part) => haystack.includes(part))
}

function latexPathCompletion(
  context: CompletionContext,
  currentFilePath?: string,
  projectFiles: Array<{ path: string; mimeType: string }> = [],
) {
  const match = context.matchBefore(/\\(?:input|include|bibliography|addbibresource)\{[^}]*|\\includegraphics(?:\[[^\]]*\])?\{[^}]*/)
  if (!match) {
    return null
  }

  const braceIndex = match.text.lastIndexOf('{')
  if (braceIndex === -1) {
    return null
  }

  const typedPath = match.text.slice(braceIndex + 1)
  const currentDir = currentFilePath ? currentFilePath.split('/').slice(0, -1).join('/') : ''
  const options = projectFiles
    .filter((file) => file.mimeType !== 'application/vnd.google-apps.folder')
    .map((file) => ({ path: toRelativePath(currentDir, file.path), mimeType: file.mimeType }))
    .filter((file) => !typedPath || file.path.startsWith(typedPath))
    .slice(0, 40)
    .map((file) => ({
      label: file.path,
      type: file.mimeType.startsWith('image/') ? 'file' as const : 'text' as const,
      detail: file.mimeType,
    }))

  return options.length ? { from: match.from + braceIndex + 1, options } : null
}

function latexPackageCompletion(context: CompletionContext) {
  const match = context.matchBefore(/\\usepackage(?:\[[^\]]*\])?\{[^}]*/)
  if (!match) {
    return null
  }

  const braceIndex = match.text.lastIndexOf('{')
  if (braceIndex === -1) {
    return null
  }

  const query = match.text.slice(braceIndex + 1).toLowerCase().split(',').pop()?.trim() ?? ''
  const options = LATEX_COMMON_PACKAGES
    .filter((entry) => !query || entry.toLowerCase().startsWith(query))
    .map((entry) => ({ label: entry, type: 'module' as const, detail: 'Common LaTeX package' }))

  return options.length ? { from: match.from + braceIndex + 1, options } : null
}

function toRelativePath(fromDir: string, targetPath: string): string {
  const fromParts = fromDir ? fromDir.split('/').filter(Boolean) : []
  const targetParts = targetPath.split('/').filter(Boolean)

  while (fromParts.length && targetParts.length && fromParts[0] === targetParts[0]) {
    fromParts.shift()
    targetParts.shift()
  }

  const prefix = fromParts.map(() => '..')
  return [...prefix, ...targetParts].join('/') || './'
}

function collectProjectSymbolCompletions(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): Completion[] {
  const completions: Completion[] = []

  for (const entry of projectTextEntries) {
    if (!/\.typ$/i.test(entry.path)) {
      continue
    }

    const functionMatches = entry.content.matchAll(/(?:^|\n)\s*#?let\s+([A-Za-z_][\w-]*)\s*\(([^\n]*)/g)
    for (const match of functionMatches) {
      completions.push({
        label: match[1],
        type: 'function',
        detail: `Project function from ${entry.path}`,
        apply: `${match[1]}(`,
      })
    }

    const valueMatches = entry.content.matchAll(/(?:^|\n)\s*#?let\s+([A-Za-z_][\w-]*)\s*=/g)
    for (const match of valueMatches) {
      completions.push({
        label: match[1],
        type: 'variable',
        detail: `Project symbol from ${entry.path}`,
        apply: match[1],
      })
    }
  }

  return completions
}

function collectLabelReferenceCompletions(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): Completion[] {
  const completions: Completion[] = []

  for (const entry of projectTextEntries) {
    const matches = entry.content.matchAll(/<([A-Za-z0-9:_-]+)>/g)
    for (const match of matches) {
      completions.push({
        label: match[1],
        type: 'constant',
        detail: `Label from ${entry.path}`,
      })
    }
  }

  return completions
}

function collectCitationCompletions(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): Completion[] {
  const completions: Completion[] = []

  for (const entry of projectTextEntries) {
    if (/\.bib$/i.test(entry.path)) {
      const bibMatches = entry.content.matchAll(/@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\}\s*(?=@|$)/g)
      for (const match of bibMatches) {
        const body = match[3] ?? ''
        const title = readBibCompletionField(body, 'title')
        const authors = readBibCompletionField(body, 'author')
        const year = readBibCompletionField(body, 'year')
        completions.push({
          label: match[2],
          type: 'text',
          detail: [title, year].filter(Boolean).join(' · ') || `Bibliography key from ${entry.path}`,
          info: [authors, entry.path].filter(Boolean).join('\n'),
        })
      }
    }

    const citeMatches = entry.content.matchAll(/@([A-Za-z0-9:_-]+)/g)
    for (const match of citeMatches) {
      completions.push({
        label: match[1],
        type: 'text',
        detail: `Reference used in ${entry.path}`,
      })
    }
  }

  return completions
}

function collectLatexLabelCompletions(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): Completion[] {
  const completions: Completion[] = []
  for (const entry of projectTextEntries) {
    if (!/\.tex$/i.test(entry.path)) {
      continue
    }
    const labels = entry.content.matchAll(/\\label\{([^}]+)\}/g)
    for (const label of labels) {
      completions.push({
        label: label[1],
        type: 'constant',
        detail: `Label from ${entry.path}`,
      })
    }
  }
  return dedupeCompletions(completions)
}

function collectLatexCitationCompletions(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): Completion[] {
  const completions: Completion[] = []
  for (const entry of projectTextEntries) {
    if (/\.bib$/i.test(entry.path)) {
      const keys = entry.content.matchAll(/@([A-Za-z]+)\s*\{\s*([^,\s]+)\s*,([\s\S]*?)\}\s*(?=@|$)/g)
      for (const key of keys) {
        const body = key[3] ?? ''
        const title = readBibCompletionField(body, 'title')
        const authors = readBibCompletionField(body, 'author')
        const year = readBibCompletionField(body, 'year')
        completions.push({
          label: key[2],
          type: 'text',
          detail: [title, year].filter(Boolean).join(' · ') || `Bibliography key from ${entry.path}`,
          info: [authors, entry.path].filter(Boolean).join('\n'),
        })
      }
      continue
    }

    if (/\.tex$/i.test(entry.path)) {
      const usedKeys = entry.content.matchAll(/\\(?:cite|citep|citet|textcite|parencite|autocite)\*?\{([^}]+)\}/g)
      for (const keyGroup of usedKeys) {
        for (const key of keyGroup[1].split(',').map((value) => value.trim()).filter(Boolean)) {
          completions.push({
            label: key,
            type: 'text',
            detail: `Citation key used in ${entry.path}`,
          })
        }
      }
    }
  }
  return dedupeCompletions(completions)
}

function readBibCompletionField(body: string, fieldName: string): string | null {
  const match = body.match(new RegExp(`${fieldName}\\s*=\\s*(?:\\{([^}]*)\\}|"([^"]*)")`, 'i'))
  const value = match?.[1] ?? match?.[2] ?? ''
  return value.trim() ? value.replace(/\s+/g, ' ').trim() : null
}

function buildLatexSyntaxDecorations(view: EditorView) {
  const decorations: { from: number; to: number; decoration: Decoration }[] = []

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    
    for (const match of text.matchAll(/%[^\n]*/g)) {
      const start = from + (match.index ?? 0)
      decorations.push({ from: start, to: start + match[0].length, decoration: Decoration.mark({ class: 'cm-latexComment' }) })
    }
    for (const match of text.matchAll(/\\[A-Za-z@]+/g)) {
      const start = from + (match.index ?? 0)
      decorations.push({ from: start, to: start + match[0].length, decoration: Decoration.mark({ class: 'cm-latexCommand' }) })
    }
    for (const match of text.matchAll(/\\\[[\s\S]*?\\\]|\$[^$\n]+\$/g)) {
      const start = from + (match.index ?? 0)
      decorations.push({ from: start, to: start + match[0].length, decoration: Decoration.mark({ class: 'cm-latexMath' }) })
    }
    for (const match of text.matchAll(/[{}]/g)) {
      const start = from + (match.index ?? 0)
      decorations.push({ from: start, to: start + 1, decoration: Decoration.mark({ class: 'cm-latexBrace' }) })
    }
  }

  // Sort by 'from' position to satisfy RangeSetBuilder requirements
  decorations.sort((a, b) => a.from - b.from)

  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to, decoration } of decorations) {
    builder.add(from, to, decoration)
  }

  return builder.finish()
}

function dedupeCompletions(entries: Completion[]): Completion[] {
  const seen = new Set<string>()
  const deduped: Completion[] = []

  for (const entry of entries) {
    const key = `${entry.label}:${entry.type ?? 'unknown'}`
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(entry)
  }

  return deduped
}

function buildEditorAssistData(
  editorLanguage: EditorLanguage,
  projectTextEntries: Array<{ path: string; mimeType: string; content: string }>,
): EditorAssistData {
  if (editorLanguage === 'latex') {
    return {
      docLookup: buildLatexDocLookup(projectTextEntries),
      typstHashCommandOptions: [],
      typstReferenceOptions: [],
      latexReferenceOptions: collectLatexLabelCompletions(projectTextEntries),
      latexCitationOptions: collectLatexCitationCompletions(projectTextEntries),
    }
  }

  if (editorLanguage === 'plain') {
    return {
      docLookup: new Map<string, TypstDocEntry>(),
      typstHashCommandOptions: [],
      typstReferenceOptions: [],
      latexReferenceOptions: [],
      latexCitationOptions: [],
    }
  }

  return {
    docLookup: buildTypstDocLookup(projectTextEntries),
    typstHashCommandOptions: dedupeCompletions(collectProjectSymbolCompletions(projectTextEntries)),
    typstReferenceOptions: dedupeCompletions([
      ...collectLabelReferenceCompletions(projectTextEntries),
      ...collectCitationCompletions(projectTextEntries),
    ]),
    latexReferenceOptions: [],
    latexCitationOptions: [],
  }
}

function buildTypstDocLookup(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): Map<string, TypstDocEntry> {
  const lookup = new Map<string, TypstDocEntry>(TYPST_DOC_ENTRIES.map((entry) => [entry.label, entry]))

  for (const entry of collectProjectSymbolDocs(projectTextEntries)) {
    lookup.set(entry.label, entry)
  }

  for (const entry of collectLabelDocs(projectTextEntries)) {
    lookup.set(entry.label, entry)
  }

  for (const entry of collectCitationDocs(projectTextEntries)) {
    lookup.set(entry.label, entry)
  }

  return lookup
}

function collectProjectSymbolDocs(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): TypstDocEntry[] {
  const entries: TypstDocEntry[] = []

  for (const entry of projectTextEntries) {
    if (!/\.typ$/i.test(entry.path)) {
      continue
    }

    const functionMatches = entry.content.matchAll(/(?:^|\n)\s*#?let\s+([A-Za-z_][\w.-]*)\s*\(([^\n)]*)\)/g)
    for (const match of functionMatches) {
      const parameters = match[2].split(',').map((value) => value.trim()).filter(Boolean)
      entries.push({
        label: match[1],
        kind: 'function',
        summary: `Project function defined in ${entry.path}.`,
        signature: `${match[1]}(${match[2].trim()})`,
        parameters,
        sourcePath: entry.path,
      })
    }

    const valueMatches = entry.content.matchAll(/(?:^|\n)\s*#?let\s+([A-Za-z_][\w.-]*)\s*=\s*([^\n]+)/g)
    for (const match of valueMatches) {
      entries.push({
        label: match[1],
        kind: 'variable',
        summary: `Project symbol defined in ${entry.path}.`,
        signature: `let ${match[1]} = ${match[2].trim()}`,
        sourcePath: entry.path,
      })
    }
  }

  return entries
}

function buildLatexDocLookup(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): Map<string, TypstDocEntry> {
  const lookup = new Map<string, TypstDocEntry>(LATEX_DOC_ENTRIES.map((entry) => [entry.label, entry]))

  for (const entry of collectLatexLabelDocs(projectTextEntries)) {
    lookup.set(entry.label, entry)
  }

  for (const entry of collectLatexCitationDocs(projectTextEntries)) {
    lookup.set(entry.label, entry)
  }

  return lookup
}

function collectLatexLabelDocs(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): TypstDocEntry[] {
  const entries: TypstDocEntry[] = []
  for (const entry of projectTextEntries) {
    if (!/\.tex$/i.test(entry.path)) {
      continue
    }
    const labels = entry.content.matchAll(/\\label\{([^}]+)\}/g)
    for (const label of labels) {
      entries.push({
        label: label[1],
        kind: 'label',
        summary: `Label anchor from ${entry.path}.`,
        signature: `\\label{${label[1]}}`,
        sourcePath: entry.path,
      })
    }
  }
  return entries
}

function collectLatexCitationDocs(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): TypstDocEntry[] {
  const entries: TypstDocEntry[] = []
  for (const entry of projectTextEntries) {
    if (!/\.bib$/i.test(entry.path)) {
      continue
    }
    const keys = entry.content.matchAll(/@[A-Za-z]+\{\s*([^,\s]+)\s*,/g)
    for (const key of keys) {
      entries.push({
        label: key[1],
        kind: 'citation',
        summary: `Bibliography key from ${entry.path}.`,
        signature: `@${key[1]}`,
        sourcePath: entry.path,
      })
    }
  }
  return entries
}

function collectLabelDocs(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): TypstDocEntry[] {
  const entries: TypstDocEntry[] = []

  for (const entry of projectTextEntries) {
    const matches = entry.content.matchAll(/<([A-Za-z0-9:_-]+)>/g)
    for (const match of matches) {
      entries.push({
        label: match[1],
        kind: 'label',
        summary: `Label anchor declared in ${entry.path}.`,
        signature: `<${match[1]}>`,
        sourcePath: entry.path,
      })
    }
  }

  return entries
}

function collectCitationDocs(projectTextEntries: Array<{ path: string; mimeType: string; content: string }>): TypstDocEntry[] {
  const entries: TypstDocEntry[] = []

  for (const entry of projectTextEntries) {
    if (/\.bib$/i.test(entry.path)) {
      const bibMatches = entry.content.matchAll(/@([A-Za-z]+)\{\s*([^,\s]+)\s*,/g)
      for (const match of bibMatches) {
        entries.push({
          label: match[2],
          kind: 'citation',
          summary: `Bibliography entry (${match[1]}) from ${entry.path}.`,
          signature: `@${match[2]}`,
          sourcePath: entry.path,
        })
      }
    }
  }

  return entries
}

function computeHoverTooltip(
  view: EditorView,
  event: MouseEvent,
  docLookup: Map<string, TypstDocEntry>,
  commentLookup: Map<string, ProjectComment>,
  wrapper: HTMLDivElement | null,
): TooltipState | null {
  if (!wrapper) {
    return null
  }

  const target = event.target instanceof Element ? event.target.closest('[data-comment-id]') : null
  const commentId = target?.getAttribute('data-comment-id')
  if (commentId) {
    const comment = commentLookup.get(commentId)
    if (comment) {
      const rect = wrapper.getBoundingClientRect()
      const position = resolveTooltipPosition({
        wrapperRect: rect,
        anchorX: event.clientX - rect.left + 14,
        anchorY: event.clientY - rect.top + 18,
        preferredPlacement: 'below',
        avoidRect: {
          left: event.clientX - rect.left - 12,
          top: event.clientY - rect.top - 12,
          right: event.clientX - rect.left + 12,
          bottom: event.clientY - rect.top + 12,
        },
      })
      return {
        left: position.left,
        top: position.top,
        entry: buildCommentTooltipEntry(comment),
        activeParameter: null,
      }
    }
  }

  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos == null) {
    return null
  }

  const token = extractTokenAt(view.state, pos)
  if (!token) {
    return null
  }

  const entry = docLookup.get(token.label)
  if (!entry) {
    return null
  }

  const rect = wrapper.getBoundingClientRect()
  const position = resolveTooltipPosition({
    wrapperRect: rect,
    anchorX: event.clientX - rect.left + 14,
    anchorY: event.clientY - rect.top + 18,
    preferredPlacement: 'below',
    avoidRect: {
      left: event.clientX - rect.left - 12,
      top: event.clientY - rect.top - 12,
      right: event.clientX - rect.left + 12,
      bottom: event.clientY - rect.top + 12,
    },
  })
  return {
    left: position.left,
    top: position.top,
    entry,
    activeParameter: null,
  }
}

function buildCommentTooltipEntry(comment: ProjectComment): TooltipEntry {
  const replyCount = comment.replies.length
  const statusLabel = comment.status === 'resolved' ? 'resolved' : comment.status === 'deleted' ? 'deleted' : 'open'
  return {
    label: comment.authorName,
    kind: 'note',
    summary: comment.content,
    signature: `${formatCommentRange(comment.startLine, comment.startColumn, comment.endLine, comment.endColumn)} · ${statusLabel}${replyCount > 0 ? ` · ${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}` : ''}`,
    sourcePath: comment.excerpt,
  }
}

function formatCommentRange(startLine: number, startColumn: number, endLine: number, endColumn: number): string {
  return `${startLine}:${startColumn} - ${endLine}:${endColumn}`
}

function computeSignatureTooltip(
  view: EditorView,
  docLookup: Map<string, TypstDocEntry>,
  wrapper: HTMLDivElement | null,
): TooltipState | null {
  if (!wrapper) {
    return null
  }

  const signatureContext = resolveSignatureContext(view.state)
  if (!signatureContext) {
    return null
  }

  const entry = docLookup.get(signatureContext.name)
  if (!entry?.signature) {
    return null
  }

  const coords = view.coordsAtPos(view.state.selection.main.head)
  const rect = wrapper.getBoundingClientRect()
  const caretTop = (coords?.top ?? rect.top) - rect.top
  const caretBottom = (coords?.bottom ?? (coords?.top ?? rect.top) + 18) - rect.top
  const caretLeft = (coords?.left ?? rect.left) - rect.left
  const position = resolveTooltipPosition({
    wrapperRect: rect,
    anchorX: caretLeft + 10,
    anchorY: caretTop - 10,
    preferredPlacement: 'above',
    avoidRect: {
      left: Math.max(0, caretLeft - 24),
      top: Math.max(0, caretTop - 6),
      right: Math.min(rect.width, caretLeft + 180),
      bottom: Math.min(rect.height, caretBottom + 6),
    },
  })
  return {
    left: position.left,
    top: position.top,
    entry,
    activeParameter: entry.parameters?.length ? Math.min(signatureContext.activeParameter, entry.parameters.length - 1) : null,
  }
}

function resolveTooltipPosition(input: {
  wrapperRect: DOMRect
  anchorX: number
  anchorY: number
  preferredPlacement: 'above' | 'below'
  avoidRect: { left: number; top: number; right: number; bottom: number }
}): { left: number; top: number } {
  const tooltipWidth = 320
  const tooltipHeight = 132
  const margin = 12
  const width = input.wrapperRect.width
  const height = input.wrapperRect.height
  const left = Math.max(margin, Math.min(width - tooltipWidth - margin, input.anchorX))

  const belowTop = Math.max(margin, Math.min(height - tooltipHeight - margin, input.anchorY + 6))
  const aboveTop = Math.max(margin, Math.min(height - tooltipHeight - margin, input.anchorY - tooltipHeight - 8))
  const intersects = (top: number) => {
    const right = left + tooltipWidth
    const bottom = top + tooltipHeight
    return !(
      right < input.avoidRect.left
      || left > input.avoidRect.right
      || bottom < input.avoidRect.top
      || top > input.avoidRect.bottom
    )
  }

  let top = input.preferredPlacement === 'above' ? aboveTop : belowTop
  if (intersects(top)) {
    top = input.preferredPlacement === 'above' ? belowTop : aboveTop
  }
  if (intersects(top)) {
    top = Math.max(margin, Math.min(height - tooltipHeight - margin, input.avoidRect.bottom + 8))
  }

  return { left, top }
}

function extractTokenAt(state: EditorState, pos: number): { label: string } | null {
  const doc = state.doc
  const length = doc.length
  if (length === 0) {
    return null
  }

  let start = pos
  let end = pos
  const tokenPattern = /[A-Za-z0-9_.:-]/

  while (start > 0 && tokenPattern.test(doc.sliceString(start - 1, start))) {
    start -= 1
  }

  while (end < length && tokenPattern.test(doc.sliceString(end, end + 1))) {
    end += 1
  }

  if (start === end) {
    return null
  }

  let label = doc.sliceString(start, end)
  if (label.startsWith('@')) {
    label = label.slice(1)
  }

  return label ? { label } : null
}

function resolveSignatureContext(state: EditorState): { name: string; activeParameter: number } | null {
  if (!state.selection.main.empty) {
    return null
  }

  const head = state.selection.main.head
  const doc = state.doc
  const lowerBound = Math.max(0, head - 400)
  let depth = 0

  for (let index = head - 1; index >= lowerBound; index -= 1) {
    const char = doc.sliceString(index, index + 1)
    if (char === ')') {
      depth += 1
      continue
    }

    if (char === '(') {
      if (depth > 0) {
        depth -= 1
        continue
      }

      let nameEnd = index
      let nameStart = index
      while (nameStart > 0 && /[A-Za-z0-9_.-]/.test(doc.sliceString(nameStart - 1, nameStart))) {
        nameStart -= 1
      }

      let name = doc.sliceString(nameStart, nameEnd).trim()
      if (name.startsWith('#')) {
        name = name.slice(1)
      }

      if (!name) {
        return null
      }

      return {
        name,
        activeParameter: countTopLevelArguments(doc.sliceString(index + 1, head)),
      }
    }
  }

  return null
}

function countTopLevelArguments(input: string): number {
  let depth = 0
  let count = 0

  for (const char of input) {
    if (char === '(' || char === '[' || char === '{') {
      depth += 1
      continue
    }

    if (char === ')' || char === ']' || char === '}') {
      depth = Math.max(0, depth - 1)
      continue
    }

    if (char === ',' && depth === 0) {
      count += 1
    }
  }

  return count
}

function EditorAssistTooltip({ tooltip }: { tooltip: TooltipState }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: tooltip.left,
        top: tooltip.top,
        maxWidth: 320,
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--card-bg)',
        border: '1px solid var(--action-border)',
        boxShadow: 'var(--surface-shadow-soft)',
        color: 'var(--text-bright)',
        pointerEvents: 'none',
        zIndex: 30,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>{tooltip.entry.label}</strong>
        <span style={{ fontSize: 11, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {tooltip.entry.kind}
        </span>
      </div>

      {tooltip.entry.signature ? (
        <div style={{ fontSize: 12, color: 'var(--text-soft)', marginBottom: 6, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {tooltip.entry.parameters && tooltip.entry.parameters.length > 0 && tooltip.activeParameter !== null
            ? renderSignatureWithHighlight(tooltip.entry.signature, tooltip.entry.parameters, tooltip.activeParameter)
            : tooltip.entry.signature}
        </div>
      ) : null}

      <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-bright)' }}>{tooltip.entry.summary}</div>

      {tooltip.entry.sourcePath ? (
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted-text)' }}>{tooltip.entry.sourcePath}</div>
      ) : null}
    </div>
  )
}

function renderSignatureWithHighlight(signature: string, parameters: string[], activeParameter: number): string {
  const parameter = parameters[activeParameter]
  if (!parameter) {
    return signature
  }

  return signature.replace(parameter, `[${parameter}]`)
}

function typstFoldService(state: EditorState, lineStart: number, _lineEnd: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart)
  const headingMatch = line.text.match(/^(=+)\s+/)
  if (!headingMatch) {
    return null
  }

  const currentDepth = headingMatch[1].length
  let endLine = state.doc.lines

  for (let lineNumber = line.number + 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const candidate = state.doc.line(lineNumber)
    const candidateMatch = candidate.text.match(/^(=+)\s+/)
    if (candidateMatch && candidateMatch[1].length <= currentDepth) {
      endLine = lineNumber - 1
      break
    }
  }

  if (endLine <= line.number) {
    return null
  }

  const end = state.doc.line(endLine).to
  return end > line.to ? { from: line.to, to: end } : null
}

function latexFoldService(state: EditorState, lineStart: number, _lineEnd: number): { from: number; to: number } | null {
  const line = state.doc.lineAt(lineStart)
  const sectionMatch = line.text.match(/^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{/)
  if (!sectionMatch) {
    return null
  }

  const currentDepth = latexSectionDepth(sectionMatch[1])
  let endLine = state.doc.lines

  for (let lineNumber = line.number + 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const candidate = state.doc.line(lineNumber)
    const candidateMatch = candidate.text.match(/^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{/)
    if (candidateMatch && latexSectionDepth(candidateMatch[1]) <= currentDepth) {
      endLine = lineNumber - 1
      break
    }
  }

  if (endLine <= line.number) {
    return null
  }

  const end = state.doc.line(endLine).to
  return end > line.to ? { from: line.to, to: end } : null
}

function latexSectionDepth(section: string): number {
  switch (section) {
    case 'part': return 1
    case 'chapter': return 2
    case 'section': return 3
    case 'subsection': return 4
    case 'subsubsection': return 5
    case 'paragraph': return 6
    case 'subparagraph': return 7
    default: return 100
  }
}

function moveToTypstSection(view: EditorView, direction: -1 | 1): boolean {
  const headings = collectHeadingLines(view.state)
  if (headings.length === 0) {
    return false
  }

  const currentLine = view.state.doc.lineAt(view.state.selection.main.head).number
  const nextLine = direction > 0
    ? headings.find((line) => line > currentLine)
    : [...headings].reverse().find((line) => line < currentLine)

  if (!nextLine) {
    return false
  }

  const target = view.state.doc.line(nextLine)
  view.dispatch({
    selection: EditorSelection.cursor(target.from),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

function collectHeadingLines(state: EditorState): number[] {
  const headings: number[] = []

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber)
    if (/^(=+)\s+/.test(line.text) || /^\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\{/.test(line.text)) {
      headings.push(lineNumber)
    }
  }

  return headings
}

function buildShortcutKeyBindings(
  bindings: ShortcutBindings | undefined,
  commands: Record<ShortcutAction, Command>,
) {
  if (!bindings) {
    return []
  }

  return (Object.entries(bindings) as Array<[ShortcutAction, string]>)
    .filter(([, key]) => Boolean(key.trim()))
    .map(([action, key]) => ({
      key,
      run: commands[action],
    }))
}

function isCitationIdentifierText(input: string): boolean {
  if (/\s/.test(input)) {
    return false
  }

  return /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i.test(input)
    || /arxiv\.org\/(?:abs|pdf)\/[A-Za-z0-9.\-]+(?:\.pdf)?/i.test(input)
    || /^(?:arxiv:)?(?:\d{4}\.\d{4,5}|[a-z\-]+\/\d{7})(?:v\d+)?$/i.test(input)
}
