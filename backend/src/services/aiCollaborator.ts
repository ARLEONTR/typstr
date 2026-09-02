import * as Y from 'yjs'
import { hocuspocusServer } from '../collaboration.js'
import { getProjectFileStorage, listProjectFiles, touchProjectFile, updateProjectFileCollaborationState } from '../db.js'
import { DRIVE_FOLDER_MIME_TYPE, readTextFileFromDrive, writeTextFileToDrive } from './drive.js'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'
import type { ProjectFile } from '../types.js'

type AiCollaboratorProjectFileInput = {
  fileId?: string
  path?: string
  mimeType?: string
  content?: string
}

type AiCollaboratorProjectFile = {
  fileId: string
  path: string
  mimeType: string
  content: string
}

type AiCollaboratorEditedFile = {
  fileId?: string
  path: string
  content: string
}

export async function aiCollaborateOnDocument(
  fileId: string,
  prompt: string,
  options: {
    provider: 'anthropic' | 'openai' | 'gemini'
    apiKey: string
    model?: string
    apply?: boolean
    source?: string
    files?: AiCollaboratorProjectFileInput[]
  },
) {
  const liveDocument = await getLiveCollaborationDocument(fileId)
  const projectFiles = await loadProjectFilesForCollaboration(fileId, liveDocument, options.source, options.files ?? [])
  const activeFile = projectFiles.find((file) => file.fileId === fileId) ?? projectFiles[0]
  const fullPrompt = `User request: ${prompt}\n\nActive file: ${activeFile?.path ?? 'unknown'}\n\nProject files:\n${formatProjectFilesForPrompt(projectFiles)}`
  const systemInstruction = [
    'You are an AI collaborator in a realtime Typst and LaTeX editor.',
    'You receive the full text project, including bibliography and support files.',
    'You may update any existing text file when the request requires it, including .bib files for new BibTeX entries.',
    'Return only valid JSON with this exact shape: {"files":[{"path":"relative/project/path","content":"full updated file content"}]}.',
    'Include only files that changed. Do not include explanations, markdown fences, or unchanged files.',
    'Do not invent new file paths; edit an existing bibliography file if a reference needs to be added.',
  ].join(' ')

  let newText = ''
  if (options.provider === 'anthropic') {
    const anthropic = new Anthropic({ apiKey: options.apiKey })
    const result = await anthropic.messages.create({
      model: options.model || 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      system: systemInstruction,
      messages: [{ role: 'user', content: fullPrompt }],
    })
    newText = result.content[0]?.type === 'text' ? result.content[0].text.trim() : ''
  } else if (options.provider === 'openai') {
    const openai = new OpenAI({ apiKey: options.apiKey })
    const result = await openai.chat.completions.create({
      model: options.model || 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: fullPrompt },
      ],
    })
    newText = result.choices[0]?.message.content?.trim() ?? ''
  } else {
    const genAI = new GoogleGenerativeAI(options.apiKey)
    const model = genAI.getGenerativeModel(
      { model: options.model || 'gemini-2.5-flash', systemInstruction, generationConfig: { responseMimeType: 'application/json' } },
      { apiVersion: 'v1beta' },
    )
    const result = await model.generateContent(fullPrompt)
    newText = result.response.text().trim()
  }

  if (!newText) throw new Error('AI returned empty content')

  const editedFiles = parseEditedFilesResponse(newText, projectFiles)

  if (options.apply === false) {
    return {
      success: true,
      content: editedFiles.find((file) => file.fileId === fileId)?.content,
      files: editedFiles,
    }
  }

  for (const editedFile of editedFiles) {
    if (editedFile.fileId === fileId && liveDocument) {
      liveDocument.transact(() => {
        const yText = liveDocument.getText('content')
        yText.delete(0, yText.length)
        yText.insert(0, editedFile.content)
      }, 'ai-collaborator')
    } else if (editedFile.fileId) {
      await persistDocumentText(editedFile.fileId, editedFile.content)
    }
  }

  return {
    success: true,
    content: editedFiles.find((file) => file.fileId === fileId)?.content,
    files: editedFiles,
  }
}

async function loadProjectFilesForCollaboration(
  activeFileId: string,
  liveDocument: Y.Doc | null,
  activeSource: string | undefined,
  clientFiles: AiCollaboratorProjectFileInput[],
): Promise<AiCollaboratorProjectFile[]> {
  const activeStorage = await getProjectFileStorage(activeFileId)
  if (!activeStorage) {
    throw new Error('Document is not available for AI collaboration')
  }

  const clientContentByFileId = new Map<string, string>()
  const clientContentByPath = new Map<string, string>()
  for (const file of clientFiles) {
    if (typeof file.content !== 'string') {
      continue
    }
    if (typeof file.fileId === 'string') {
      clientContentByFileId.set(file.fileId, file.content)
    }
    if (typeof file.path === 'string') {
      clientContentByPath.set(normalizeProjectPath(file.path), file.content)
    }
  }

  const projectFiles = await listProjectFiles(activeStorage.file.projectId)
  const textFiles = projectFiles
    .filter(isAiEditableProjectFile)
    .sort((left, right) => left.path.localeCompare(right.path))

  const entries: AiCollaboratorProjectFile[] = []
  for (const file of textFiles) {
    const clientContent = clientContentByFileId.get(file.id) ?? clientContentByPath.get(normalizeProjectPath(file.path))
    const content = file.id === activeFileId && typeof activeSource === 'string'
      ? activeSource
      : clientContent ?? await readDocumentText(file.id, file.id === activeFileId ? liveDocument : null)
    entries.push({
      fileId: file.id,
      path: file.path,
      mimeType: file.mimeType,
      content,
    })
  }

  return entries
}

function formatProjectFilesForPrompt(files: AiCollaboratorProjectFile[]): string {
  return files.map((file) => [
    `<file path="${escapePromptAttribute(file.path)}" fileId="${escapePromptAttribute(file.fileId)}" mimeType="${escapePromptAttribute(file.mimeType)}">`,
    file.content,
    '</file>',
  ].join('\n')).join('\n\n')
}

function parseEditedFilesResponse(responseText: string, projectFiles: AiCollaboratorProjectFile[]): AiCollaboratorEditedFile[] {
  const jsonText = extractJsonText(responseText)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('AI returned an invalid multi-file edit response')
  }

  const rawFiles = Array.isArray((parsed as { files?: unknown }).files)
    ? (parsed as { files: unknown[] }).files
    : []
  const fileById = new Map(projectFiles.map((file) => [file.fileId, file] as const))
  const fileByPath = new Map(projectFiles.map((file) => [normalizeProjectPath(file.path), file] as const))
  const originalByFileId = new Map(projectFiles.map((file) => [file.fileId, file.content] as const))
  const changedByFileId = new Map<string, AiCollaboratorEditedFile>()

  for (const rawFile of rawFiles) {
    if (!rawFile || typeof rawFile !== 'object') {
      continue
    }

    const fileId = typeof (rawFile as { fileId?: unknown }).fileId === 'string'
      ? (rawFile as { fileId: string }).fileId
      : undefined
    const path = typeof (rawFile as { path?: unknown }).path === 'string'
      ? (rawFile as { path: string }).path
      : ''
    const content = typeof (rawFile as { content?: unknown }).content === 'string'
      ? (rawFile as { content: string }).content
      : null
    const target = (fileId ? fileById.get(fileId) : undefined) ?? fileByPath.get(normalizeProjectPath(path))
    if (!target || content === null || content === originalByFileId.get(target.fileId)) {
      continue
    }

    changedByFileId.set(target.fileId, {
      fileId: target.fileId,
      path: target.path,
      content,
    })
  }

  return [...changedByFileId.values()]
}

function extractJsonText(responseText: string): string {
  const trimmed = responseText.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

function normalizeProjectPath(path: string): string {
  return path.trim().replace(/^\/+/, '').replace(/\\/g, '/')
}

function escapePromptAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function isAiEditableProjectFile(file: ProjectFile): boolean {
  if (file.mimeType === DRIVE_FOLDER_MIME_TYPE) {
    return false
  }

  if (file.mimeType.startsWith('text/')) {
    return true
  }

  return /\.(typ|txt|md|json|yaml|yml|bib|csv|toml|xml|svg|tex|ltx|latex|cls|sty|bst|bbx|cbx|def|clo|cfg|csl)$/i.test(file.name)
}

async function getLiveCollaborationDocument(fileId: string): Promise<Y.Doc | null> {
  try {
    return (await hocuspocusServer.documents.get(fileId)) ?? null
  } catch {
    return null
  }
}

async function readDocumentText(fileId: string, liveDocument: Y.Doc | null): Promise<string> {
  if (liveDocument) {
    return liveDocument.getText('content').toString()
  }

  const storage = await getProjectFileStorage(fileId)
  if (!storage) {
    throw new Error('Document is not available for AI collaboration')
  }

  if (storage.collaborationState) {
    const document = new Y.Doc()
    Y.applyUpdate(document, storage.collaborationState)
    return document.getText('content').toString()
  }

  return readTextFileFromDrive(storage.ownerUserId, storage.file.driveFileId)
}

async function persistDocumentText(fileId: string, content: string): Promise<void> {
  const storage = await getProjectFileStorage(fileId)
  if (!storage) {
    throw new Error('Document is not available for AI collaboration')
  }

  await writeTextFileToDrive(storage.ownerUserId, storage.file.driveFileId, content)
  const document = new Y.Doc()
  document.getText('content').insert(0, content)
  await updateProjectFileCollaborationState(fileId, Y.encodeStateAsUpdate(document))
  await touchProjectFile(fileId)
}
