import { Router } from 'express'
import {
  createProjectComment,
  createProjectCommentReply,
  getProjectCommentById,
  getProjectFileById,
  getProjectReviewRequestByToken,
  listProjectFiles,
  listProjectComments,
} from '../db.js'
import { DRIVE_FOLDER_MIME_TYPE, readTextFileFromDrive } from '../services/drive.js'
import { compileLatexProjectToPdf, compileTypstProjectToSvg, parseCompileDiagnostics } from '../services/compiler.js'
import { listProjectFileRevisions } from '../services/reliability.js'
import { loadProjectWorkspace } from '../services/projectWorkspace.js'
import { ensureTypstPreviewSession, proxyTypstPreviewRequest } from '../services/tinymistPreview.js'
import { getLanguageServerStatuses } from '../services/languageServers.js'
import { validateEmail, validateOptionalString, validateString } from '../validation.js'

export const reviewRouter = Router()

reviewRouter.get('/:token', async (req, res, next) => {
  try {
    const review = await getProjectReviewRequestByToken(req.params.token)
    if (!review) return res.status(404).json({ error: 'Review link not found or expired.' })

    const [source, revisions, projectFiles] = await Promise.all([
      readTextFileFromDrive(review.owner_user_id, review.file_drive_file_id),
      listProjectFileRevisions(review.file_id, 50),
      listProjectFiles(review.project_id),
    ])
    const textFiles = projectFiles
      .filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE && isReviewTextFile(file.path, file.mimeType))
      .slice(0, 200)
    const files = await Promise.all(textFiles.map(async (file) => ({
      id: file.id,
      path: file.path,
      mimeType: file.mimeType,
      content: file.id === review.file_id
        ? source
        : await readTextFileFromDrive(review.owner_user_id, file.driveFileId),
    })))
    const commentsByFile = await Promise.all(textFiles.map((file) => listProjectComments(file.id)))
    const comments = commentsByFile.flat()

    res.json({
      id: review.id,
      projectId: review.project_id,
      projectTitle: review.project_title,
      fileId: review.file_id,
      filePath: review.file_path,
      supervisorEmail: review.supervisor_email,
      supervisorName: review.supervisor_name,
      sharedByName: review.requester_name,
      sharedByEmail: review.requester_email,
      message: review.message,
      sourceRevisionId: review.source_revision_id,
      createdAt: review.created_at,
      expiresAt: review.expires_at,
      source,
      files,
      comments,
      revisions,
      tracking: {
        open: comments.filter((comment) => comment.reviewRequestId === review.id && comment.status === 'open').length,
        addressed: comments.filter((comment) => comment.reviewRequestId === review.id && comment.status === 'resolved').length,
      },
    })
  } catch (error) {
    next(error)
  }
})

function isReviewTextFile(path: string, mimeType: string): boolean {
  if (mimeType.startsWith('text/')) return true
  return /\.(typ|typst|tex|ltx|latex|bib|csl|json|ya?ml|toml|csv|tsv|txt|md|svg|cls|sty|bst|bbx|cbx|def|clo|cfg)$/i.test(path)
}

reviewRouter.post('/:token/comments', async (req, res, next) => {
  try {
    const review = await getProjectReviewRequestByToken(req.params.token)
    if (!review) return res.status(404).json({ error: 'Review link not found or expired.' })

    const emailResult = validateEmail(req.body.authorEmail ?? review.supervisor_email)
    if (!emailResult.valid) return res.status(400).json({ error: emailResult.error })
    const nameResult = validateOptionalString(req.body.authorName ?? review.supervisor_name, { maxLength: 120, label: 'Name' })
    if (!nameResult.valid) return res.status(400).json({ error: nameResult.error })
    const contentResult = validateString(req.body.content, { maxLength: 5000, required: true, label: 'Comment' })
    if (!contentResult.valid) return res.status(400).json({ error: contentResult.error })
    const excerptResult = validateString(req.body.excerpt, { maxLength: 10000, required: false, label: 'Excerpt' })
    if (!excerptResult.valid) return res.status(400).json({ error: excerptResult.error })

    const startLine = Number(req.body.startLine) || 1
    const startColumn = Number(req.body.startColumn) || 1
    const endLine = Number(req.body.endLine) || startLine
    const endColumn = Number(req.body.endColumn) || Math.max(1, startColumn)
    if (![startLine, startColumn, endLine, endColumn].every((value) => Number.isInteger(value) && value > 0)) {
      return res.status(400).json({ error: 'Comment coordinates must be positive integers.' })
    }

    const targetFileId = typeof req.body.fileId === 'string' ? req.body.fileId : review.file_id
    const targetFile = await getProjectFileById(targetFileId)
    if (!targetFile || targetFile.projectId !== review.project_id || targetFile.mimeType === DRIVE_FOLDER_MIME_TYPE || !isReviewTextFile(targetFile.path, targetFile.mimeType)) {
      return res.status(404).json({ error: 'Reviewable file not found.' })
    }

    const comment = await createProjectComment({
      projectId: review.project_id,
      fileId: targetFile.id,
      authorUserId: null,
      anonymousAuthorName: nameResult.value ?? emailResult.value,
      anonymousAuthorEmail: emailResult.value,
      reviewRequestId: review.id,
      content: contentResult.value,
      excerpt: excerptResult.value || contentResult.value.slice(0, 240),
      startLine,
      startColumn,
      endLine,
      endColumn,
    })

    res.status(201).json(comment)
  } catch (error) {
    next(error)
  }
})

reviewRouter.post('/:token/typst-preview-session', async (req, res, next) => {
  try {
    const review = await getProjectReviewRequestByToken(req.params.token)
    if (!review) return res.status(404).json({ error: 'Review link not found or expired.' })

    const fileId = typeof req.body.fileId === 'string' ? req.body.fileId : review.file_id
    const source = typeof req.body.source === 'string' ? req.body.source : ''
    const sessionId = typeof req.body.sessionId === 'string' && req.body.sessionId.trim()
      ? req.body.sessionId.trim()
      : `review-preview:${review.id}:${fileId}`

    if (!source.trim()) return res.status(400).json({ error: 'source is required' })

    const file = await getProjectFileById(fileId)
    if (!file || file.projectId !== review.project_id || file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      return res.status(404).json({ error: 'File not found' })
    }

    const workspace = await loadProjectWorkspace({
      projectId: review.project_id,
      ownerUserId: review.owner_user_id,
      entryFileId: file.id,
      entryPath: file.path,
      sourceOverride: {
        fileId: file.id,
        content: source,
      },
    })
    const descriptor = await ensureTypstPreviewSession({
      projectId: review.project_id,
      sessionId,
      workspace,
    })
    const compileResult = descriptor.ready
      ? { diagnostics: [] }
      : await compileTypstProjectToSvg(workspace, { timeoutMs: 20_000 }).catch((error) => ({
        diagnostics: [{
          level: 'error' as const,
          message: error instanceof Error ? error.message : String(error),
          filePath: file.path,
          line: null,
          column: null,
          raw: error instanceof Error ? error.message : String(error),
        }],
      }))

    res.json({
      ...descriptor,
      proxyPath: `/api/review/${encodeURIComponent(req.params.token)}/tinymist-preview/${encodeURIComponent(descriptor.sessionId)}`,
      statuses: getLanguageServerStatuses(),
      compileDiagnostics: compileResult.diagnostics,
    })
  } catch (error) {
    next(error)
  }
})

reviewRouter.post('/:token/latex-preview', async (req, res, next) => {
  try {
    const review = await getProjectReviewRequestByToken(req.params.token)
    if (!review) return res.status(404).json({ error: 'Review link not found or expired.' })

    const fileId = typeof req.body.fileId === 'string' ? req.body.fileId : review.file_id
    const source = typeof req.body.source === 'string' ? req.body.source : ''
    const engine = req.body.latexEngine === 'pdflatex' || req.body.latexEngine === 'lualatex' || req.body.latexEngine === 'xelatex'
      ? req.body.latexEngine
      : 'xelatex'

    if (!source.trim()) return res.status(400).json({ error: 'source is required' })

    const file = await getProjectFileById(fileId)
    if (!file || file.projectId !== review.project_id || file.mimeType === DRIVE_FOLDER_MIME_TYPE || !/\.(tex|ltx|latex)$/i.test(file.path)) {
      return res.status(404).json({ error: 'LaTeX file not found' })
    }

    const workspace = await loadProjectWorkspace({
      projectId: review.project_id,
      ownerUserId: review.owner_user_id,
      entryFileId: file.id,
      entryPath: file.path,
      sourceOverride: {
        fileId: file.id,
        content: source,
      },
    })

    const result = await compileLatexProjectToPdf({
      entryPath: workspace.entryPath,
      files: workspace.files,
      engine,
    }, { timeoutMs: 60_000 })

    res.json({
      format: 'pdf',
      pdfBase64: result.pdf.toString('base64'),
      engine: result.engine,
      log: result.log,
      diagnostics: [],
      syncTex: result.syncTex,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.status(422).json({
      error: message,
      diagnostics: parseCompileDiagnostics(message),
    })
  }
})

reviewRouter.all('/:token/tinymist-preview/:sessionId', async (req, res, next) => {
  try {
    const review = await getProjectReviewRequestByToken(req.params.token)
    if (!review) return res.status(404).json({ error: 'Review link not found or expired.' })
    await proxyTypstPreviewRequest(req, res)
  } catch (error) {
    next(error)
  }
})

reviewRouter.all('/:token/tinymist-preview/:sessionId/*path', async (req, res, next) => {
  try {
    const review = await getProjectReviewRequestByToken(req.params.token)
    if (!review) return res.status(404).json({ error: 'Review link not found or expired.' })
    await proxyTypstPreviewRequest(req, res)
  } catch (error) {
    next(error)
  }
})

reviewRouter.post('/:token/comments/:commentId/replies', async (req, res, next) => {
  try {
    const review = await getProjectReviewRequestByToken(req.params.token)
    if (!review) return res.status(404).json({ error: 'Review link not found or expired.' })
    const comment = await getProjectCommentById(req.params.commentId)
    if (!comment || comment.projectId !== review.project_id) {
      return res.status(404).json({ error: 'Comment not found.' })
    }

    const emailResult = validateEmail(req.body.authorEmail ?? review.supervisor_email)
    if (!emailResult.valid) return res.status(400).json({ error: emailResult.error })
    const nameResult = validateOptionalString(req.body.authorName ?? review.supervisor_name, { maxLength: 120, label: 'Name' })
    if (!nameResult.valid) return res.status(400).json({ error: nameResult.error })
    const contentResult = validateString(req.body.content, { maxLength: 5000, required: true, label: 'Reply' })
    if (!contentResult.valid) return res.status(400).json({ error: contentResult.error })

    const updated = await createProjectCommentReply({
      commentId: comment.id,
      projectId: review.project_id,
      fileId: review.file_id,
      authorUserId: null,
      anonymousAuthorName: nameResult.value ?? emailResult.value,
      anonymousAuthorEmail: emailResult.value,
      content: contentResult.value,
    })
    res.status(201).json(updated)
  } catch (error) {
    next(error)
  }
})
