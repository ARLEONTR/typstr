import { Router } from 'express'
import { getAuthenticatedUser } from '../auth.js'
import { parseCompileDiagnostics } from '../services/compiler.js'
import { countQueuedCompileJobsForUser, runCoalescedCompileJobAndWait } from '../services/reliability.js'
import { getBillingStatus } from '../services/billing.js'
import type { CompileRequest, CompilePreviewFormat } from '../types.js'

export const compileRouter = Router()

// POST /api/compile
// Body: { source: string }
// Response: { pages: string[] }  — array of SVG strings, one per page
compileRouter.post('/', async (req, res) => {
  const { source, projectId, fileId, activeFileId, activeSource, format, previewSessionId, svgPageIndex, svgWindowSize } = req.body as CompileRequest
  const documentFormat = req.body?.documentFormat as CompileRequest['documentFormat']
  const latexEngine = req.body?.latexEngine as CompileRequest['latexEngine']

  if (typeof source !== 'string' || !source.trim()) {
    return res.status(400).json({ error: 'source must be a non-empty string' })
  }

  if (source.length > 2_000_000) {
    return res.status(400).json({ error: 'Source must be at most 2000000 characters' })
  }

  if (format !== undefined && format !== 'svg' && format !== 'pdf') {
    return res.status(400).json({ error: 'format must be svg or pdf' })
  }

  if (documentFormat !== undefined && documentFormat !== 'typst' && documentFormat !== 'latex') {
    return res.status(400).json({ error: 'documentFormat must be typst or latex' })
  }

  if (latexEngine !== undefined && latexEngine !== 'pdflatex' && latexEngine !== 'xelatex' && latexEngine !== 'lualatex') {
    return res.status(400).json({ error: 'latexEngine must be pdflatex, xelatex, or lualatex' })
  }

  if (svgPageIndex !== undefined && (!Number.isInteger(svgPageIndex) || svgPageIndex < 0)) {
    return res.status(400).json({ error: 'svgPageIndex must be a non-negative integer' })
  }

  if (svgWindowSize !== undefined && (!Number.isInteger(svgWindowSize) || svgWindowSize < 1 || svgWindowSize > 12)) {
    return res.status(400).json({ error: 'svgWindowSize must be an integer between 1 and 12' })
  }

  try {
    const previewFormat: CompilePreviewFormat = format ?? 'svg'
    const user = getAuthenticatedUser(req)
    const billing = await getBillingStatus(user.id)

    const queuedCount = await countQueuedCompileJobsForUser(user.id)
    if (queuedCount >= 3) {
      return res.status(429).json({ error: 'Too many compile requests queued. Please wait for current compiles to finish.' })
    }

    const result = await runCoalescedCompileJobAndWait({
      userId: user.id,
      source,
      projectId,
      fileId,
      activeFileId,
      activeSource,
      documentFormat,
      latexEngine,
      format: previewFormat,
      previewSessionId,
      svgPageIndex,
      svgWindowSize,
      compileTimeoutMs: (billing.limits.compileTimeoutSeconds ?? 60) * 1000,
    }, { timeoutMs: Math.min(90_000, (billing.limits.compileTimeoutSeconds ?? 90) * 1000 + 10_000) })

    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const typedError = err as { status?: number; code?: string; limitKey?: string; statusPayload?: unknown }
    if (typedError.status) {
      return res.status(typedError.status).json({
        error: message,
        code: typedError.code ?? null,
        limitKey: typedError.limitKey ?? null,
        billing: typedError.statusPayload ?? null,
      })
    }
    res.status(422).json({
      error: message,
      diagnostics: parseCompileDiagnostics(message),
    })
  }
})
