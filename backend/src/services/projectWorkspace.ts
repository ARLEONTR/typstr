import { listProjectFiles } from '../db.js'
import { DRIVE_FOLDER_MIME_TYPE, readFileBufferFromDrive } from './drive.js'

export interface ProjectWorkspaceFile {
  path: string
  content: string | Buffer
  mimeType: string
}

export interface ProjectWorkspace {
  entryPath: string
  files: ProjectWorkspaceFile[]
  revisionId: number
}

import { LRUCache } from 'lru-cache'

type WorkspaceCacheFile = {
  path: string
  mimeType: string
  updatedAt: number
  content: string | Buffer
}

type WorkspaceProjectCache = {
  revisionId: number
  files: Map<string, WorkspaceCacheFile>
}

const workspaceCache = new LRUCache<string, WorkspaceProjectCache>({
  max: 50,
  ttl: 1000 * 60 * 30,
})
const workspaceRevisionIds = new Map<string, number>()

export function getProjectWorkspaceRevisionId(projectId: string): number {
  return workspaceRevisionIds.get(projectId) ?? 0
}

function bumpProjectWorkspaceRevision(projectId: string): number {
  const nextRevisionId = getProjectWorkspaceRevisionId(projectId) + 1
  workspaceRevisionIds.set(projectId, nextRevisionId)
  return nextRevisionId
}

export async function loadProjectWorkspaceFiles(input: {
  projectId: string
  ownerUserId: string
  sourceOverride?: {
    fileId: string
    content: string
  }
  additionalOverrides?: Array<{ fileId: string; content: string }>
}): Promise<ProjectWorkspaceFile[]> {
  const projectFiles = await listProjectFiles(input.projectId)
  const revisionId = getProjectWorkspaceRevisionId(input.projectId)
  const cachedProject = workspaceCache.get(input.projectId)
  const projectCache = cachedProject?.revisionId === revisionId ? cachedProject.files : new Map<string, WorkspaceCacheFile>()
  const nextCache = new Map<string, WorkspaceCacheFile>()

  const overrideMap = new Map<string, string>()
  if (input.sourceOverride) overrideMap.set(input.sourceOverride.fileId, input.sourceOverride.content)
  for (const o of input.additionalOverrides ?? []) overrideMap.set(o.fileId, o.content)

  const files = await Promise.all(projectFiles.filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE).map(async (file) => {
    const overriddenContent = overrideMap.get(file.id)
    if (overriddenContent !== undefined) {
      return {
        path: file.path,
        content: overriddenContent,
        mimeType: file.mimeType,
      }
    }

    const cached = projectCache.get(file.id)
    if (!overrideMap.has(file.id) && cached && cached.updatedAt === file.updatedAt && cached.path === file.path && cached.mimeType === file.mimeType) {
      nextCache.set(file.id, cached)
      return {
        path: cached.path,
        content: cached.content,
        mimeType: cached.mimeType,
      }
    }

    let buffer: Buffer
    try {
      buffer = await readFileBufferFromDrive(input.ownerUserId, file.driveFileId)
    } catch (error) {
      if (!isMissingWorkspaceFileError(error)) {
        throw error
      }

      return null
    }

    const content = isTextLikeFile(file.path, file.mimeType) ? buffer.toString('utf8') : buffer
    const cacheEntry = {
      path: file.path,
      mimeType: file.mimeType,
      updatedAt: file.updatedAt,
      content,
    }
    nextCache.set(file.id, cacheEntry)

    return {
      path: file.path,
      content,
      mimeType: file.mimeType,
    }
  }))

  workspaceCache.set(input.projectId, {
    revisionId,
    files: nextCache,
  })

  return files.filter((file): file is ProjectWorkspaceFile => file !== null)
}

export async function loadProjectWorkspace(input: {
  projectId: string
  ownerUserId: string
  entryFileId: string
  entryPath: string
  sourceOverride?: {
    fileId: string
    content: string
  }
  additionalOverrides?: Array<{ fileId: string; content: string }>
}): Promise<ProjectWorkspace> {
  const files = await loadProjectWorkspaceFiles({
    projectId: input.projectId,
    ownerUserId: input.ownerUserId,
    sourceOverride: input.sourceOverride,
    additionalOverrides: input.additionalOverrides,
  })

  return {
    entryPath: input.entryPath,
    files,
    revisionId: getProjectWorkspaceRevisionId(input.projectId),
  }
}

export function invalidateProjectWorkspaceCache(projectId: string): void {
  bumpProjectWorkspaceRevision(projectId)
  workspaceCache.delete(projectId)
}

export function invalidateProjectWorkspaceFile(projectId: string, fileId: string): void {
  bumpProjectWorkspaceRevision(projectId)
  const cache = workspaceCache.get(projectId)
  if (cache) cache.files.delete(fileId)
}

export function invalidateProjectWorkspaceSubtree(projectId: string, pathPrefix: string): void {
  bumpProjectWorkspaceRevision(projectId)
  const cache = workspaceCache.get(projectId)
  if (!cache) return
  for (const [fileId, entry] of cache.files) {
    if (entry.path === pathPrefix || entry.path.startsWith(`${pathPrefix}/`)) {
      cache.files.delete(fileId)
    }
  }
}

function isTextLikeFile(filePath: string, mimeType: string): boolean {
  if (mimeType.startsWith('text/')) {
    return true
  }

  return /\.(typ|txt|md|json|yaml|yml|bib|csv|toml|xml|svg|tex|cls|sty|bst|dtx|ins|bbl|aux|tikz|ltx)$/i.test(filePath)
}

function isMissingWorkspaceFileError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { code?: string; status?: number }).code === 'drive_file_missing'
    && (error as { code?: string; status?: number }).status === 404,
  )
}
