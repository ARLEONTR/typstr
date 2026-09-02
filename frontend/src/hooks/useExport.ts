import { useState, useCallback } from 'react'
import { apiClient } from '../api/client'
import type { ExportFormat, ProjectFormat } from '../types'

export interface ExportLogEntry {
  id: string
  level: 'info' | 'warning' | 'error'
  message: string
  timestamp: number
}

const EXTENSION_MAP: Record<ExportFormat, string> = {
  docx: 'docx',
  latex: 'tex',
  html: 'html',
  pdf: 'pdf',
}

interface ExportContext {
  projectId?: string
  fileId?: string
  projectTitle?: string
  documentFormat?: 'typst' | 'latex'
  targetProjectFormat?: ProjectFormat
}

interface SaveExportResult {
  saved: true
  name: string
  driveFileId: string
}

function buildExportContext(context?: ExportContext) {
  return {
    projectId: context?.projectId,
    fileId: context?.fileId,
    documentFormat: context?.documentFormat,
  }
}

export function useExport() {
  const [isExporting, setIsExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportLogs, setExportLogs] = useState<ExportLogEntry[]>([])

  const appendExportLog = useCallback((level: ExportLogEntry['level'], message: string) => {
    setExportLogs((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        level,
        message,
        timestamp: Date.now(),
      },
      ...current,
    ].slice(0, 40))
  }, [])

  const clearExportLogs = useCallback(() => {
    setExportLogs([])
  }, [])

  const exportDocument = useCallback(async (source: string, format: ExportFormat, filename = 'document', context?: ExportContext) => {
    if (!source.trim()) return
    setIsExporting(true)
    setExportError(null)
    try {
      const res = await apiClient.post(
        '/api/export',
        { source, ...buildExportContext(context), format },
        { responseType: 'blob' }
      )
      const ext = EXTENSION_MAP[format]
      const blob = new Blob([res.data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${filename}.${ext}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      appendExportLog('info', `Downloaded ${filename}.${ext}.`)
    } catch (err: any) {
      let message = 'Export failed'
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text()
          const json = JSON.parse(text)
          message = json.error ?? text
        } catch {
          // ignore
        }
      }
      setExportError(message)
      appendExportLog('error', message)
    } finally {
      setIsExporting(false)
    }
  }, [appendExportLog])

  const saveExportToDrive = useCallback(async (source: string, format: ExportFormat, context: ExportContext) => {
    if (!source.trim()) return null
    if (!context.projectId || !context.fileId) {
      throw new Error('projectId and fileId are required to save exports to Google Drive')
    }

    setIsExporting(true)
    setExportError(null)
    try {
      const res = await apiClient.post<SaveExportResult>('/api/export', {
        source,
        ...buildExportContext(context),
        format,
        saveToDrive: true,
      })

      appendExportLog('info', `${res.data.name} saved to the project Drive folder.`)

      return res.data
    } catch (err: any) {
      const message = err.response?.data?.error ?? 'Saving export to Google Drive failed'
      setExportError(message)
      appendExportLog('error', message)
      throw err
    } finally {
      setIsExporting(false)
    }
  }, [appendExportLog])

  const downloadProjectZip = useCallback(async (context: ExportContext, source?: string) => {
    if (!context.projectId) {
      throw new Error('projectId is required to download a project ZIP')
    }

    setIsExporting(true)
    setExportError(null)
    try {
      const res = await apiClient.post(
        '/api/export/project-zip',
        {
          projectId: context.projectId,
          fileId: context.fileId,
          source,
          targetProjectFormat: context.targetProjectFormat,
        },
        { responseType: 'blob' },
      )

      const blob = new Blob([res.data], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${context.projectTitle ?? 'project'}.zip`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      appendExportLog('info', `Downloaded ${context.projectTitle ?? 'project'}.zip.`)
    } catch (err: any) {
      let message = 'Project ZIP download failed'
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text()
          const json = JSON.parse(text)
          message = json.error ?? text
        } catch {
          // ignore
        }
      }
      setExportError(message)
      appendExportLog('error', message)
      throw err
    } finally {
      setIsExporting(false)
    }
  }, [appendExportLog])

  return { isExporting, exportError, exportLogs, clearExportLogs, exportDocument, saveExportToDrive, downloadProjectZip }
}
