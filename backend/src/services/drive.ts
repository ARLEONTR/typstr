import { mkdir, readFile, rename, rm, stat, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { google, type drive_v3 } from 'googleapis'
import * as Y from 'yjs'
import { findUserById, getProjectByDriveFolderId, getProjectFileByStorageId, updateProjectDriveFolderId, updateUserDriveRootFolder } from '../db.js'
import { LRUCache } from 'lru-cache'
import { env } from '../env.js'
import type { ProjectRole, UserRecord } from '../types.js'

const driveFileBufferCache = new LRUCache<string, Buffer>({
  max: 300,
  maxSize: 64 * 1024 * 1024,
  sizeCalculation: (val) => val.length,
  ttl: 1000 * 60 * 30, // 30 minutes
})

export function invalidateDriveFileCache(fileId: string): void {
  driveFileBufferCache.delete(fileId)
}

export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
export const GOOGLE_DOC_MIME_TYPE = 'application/vnd.google-apps.document'
const GOOGLE_WORKSPACE_MIME_TYPE_PREFIX = 'application/vnd.google-apps.'

/** Folder names that are internal to the app and must never be surfaced as user projects or project files. */
const INTERNAL_FOLDER_NAMES = new Set(['.typstr', '_typstr-library'])

function isInternalEntry(name: string): boolean {
  return INTERNAL_FOLDER_NAMES.has(name) || name.startsWith('.')
}

/** Map a googleapis/GaxiosError into a user-readable Error. */
function mapDriveError(error: unknown): Error {
  if (error && typeof error === 'object') {
    const e = error as Record<string, any>
    const status: number = e?.response?.status ?? e?.status ?? 0
    const reason: string = e?.response?.data?.error?.errors?.[0]?.reason ?? e?.errors?.[0]?.reason ?? ''
    const message: string = e?.response?.data?.error?.message ?? e?.message ?? ''
    const loweredMessage = message.toLowerCase()

    console.warn('[Google Drive API Error] status=%d reason=%s message=%s', status, reason, message)

    if (
      reason === 'storageQuotaExceeded'
      || reason === 'quotaExceeded'
      || loweredMessage.includes('storage quota')
      || loweredMessage.includes('storagequota')
      || loweredMessage.includes('drive storage')
      || loweredMessage.includes('quota has been exceeded')
    ) {
      const quotaError = new Error('Google Drive storage is full. Free up space in your Google Drive, then try creating the Typstr folder or project again.') as Error & { code?: string; status?: number }
      quotaError.code = 'drive_storage_quota_exceeded'
      quotaError.status = 507
      return quotaError
    }
    if (reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded') {
      return new Error('Google Drive rate limit reached. Please wait a moment and try again.')
    }
    if (status === 401 || reason === 'authError') {
      const authError = new Error('Google Drive authentication expired. Please sign in again.') as Error & { code?: string; status?: number }
      authError.code = 'google_reauth_required'
      authError.status = 401
      return authError
    }
    if (status === 403) {
      if (
        reason === 'insufficientPermissions'
        || reason === 'forbidden'
        || reason === 'insufficientFilePermissions'
        || reason === 'appNotAuthorizedToFile'
        || loweredMessage.includes('insufficient')
        || loweredMessage.includes('permission')
        || loweredMessage.includes('access denied')
        || loweredMessage.includes('forbidden')
        || loweredMessage.includes('scope')
      ) {
        const scopeError = new Error('Google Drive permission required. Please grant Drive access.') as Error & { code?: string; status?: number }
        scopeError.code = 'drive_scope_required'
        scopeError.status = 403
        return scopeError
      }
      const accessError = new Error(`Google Drive access denied: ${message || 'check your Drive permissions and try again.'}`) as Error & { status?: number }
      accessError.status = 403
      return accessError
    }
    if (status === 404) {
      return new Error('Google Drive item not found. It may have been deleted or moved.')
    }
    if (status >= 500) {
      return new Error('Google Drive service error. Please try again in a moment.')
    }
  }

  console.error('[Google Drive Unexpected Error]', error)
  return error instanceof Error ? error : new Error(String(error))
}

export interface DriveTreeEntry {
  id: string
  name: string
  path: string
  mimeType: string
}

function getOAuthClient(user: UserRecord) {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleCallbackUrl) {
    console.error('[Google Drive Config Error] Google OAuth is not configured. Missing client ID, secret, or callback URL.')
    throw new Error('Google OAuth is not configured')
  }

  if (!user.refreshToken) {
    console.warn('[Google Drive Auth Warning] User %s (%s) does not have a Google refresh token.', user.id, user.email)
    const error = new Error(`User ${user.email} does not have a Google refresh token. Re-authentication is required.`) as Error & {
      code?: string
      status?: number
    }
    error.code = 'google_reauth_required'
    error.status = 401
    throw error
  }

  const client = new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleCallbackUrl)
  client.setCredentials({ refresh_token: user.refreshToken })
  return client
}

function getDrive(user: UserRecord) {
  return google.drive({ version: 'v3', auth: getOAuthClient(user) })
}

function isLocalDevIdentity(user: Pick<UserRecord, 'googleId' | 'email'>): boolean {
  return (
    user.googleId.startsWith('local-dev:') ||
    user.googleId.startsWith('ldap:') ||
    user.email.trim().toLowerCase() === env.localAuthBypassEmail.trim().toLowerCase()
  )
}

export async function shouldUseLocalFileStorage(userId: string): Promise<boolean> {
  if (env.localFileStorageEnabled || !env.googleClientId || !env.googleClientSecret) {
    return true
  }

  const user = await requireUser(userId)
  return isLocalDevIdentity(user)
}

export async function ensureUserDriveRootFolder(userId: string): Promise<string> {
  if (await shouldUseLocalFileStorage(userId)) {
    const user = await requireUser(userId)
    if (user.driveRootFolderId) {
      await mkdir(user.driveRootFolderId, { recursive: true })
      return user.driveRootFolderId
    }

    const rootFolder = path.join(env.localStorageRoot, 'users', userId)
    await mkdir(rootFolder, { recursive: true })
    await updateUserDriveRootFolder(userId, rootFolder)
    return rootFolder
  }

  const user = await requireUser(userId)

  if (user.driveRootFolderId) {
    return user.driveRootFolderId
  }

  const error = new Error('Drive workspace folder is not configured yet. Choose your Typstr workspace folder first.') as Error & {
    code?: string
    status?: number
  }
  error.code = 'drive_workspace_required'
  error.status = 412
  throw error
}

export async function initializeUserDriveRootFolder(userId: string, folderName: string): Promise<string> {
  if (await shouldUseLocalFileStorage(userId)) {
    const rootFolder = path.join(env.localStorageRoot, 'users', userId, folderName)
    await mkdir(rootFolder, { recursive: true })
    await updateUserDriveRootFolder(userId, rootFolder)
    return rootFolder
  }

  const user = await requireUser(userId)
  if (user.driveRootFolderId) {
    return user.driveRootFolderId
  }

  const drive = getDrive(user)

  // Reuse an existing folder with the same name in Drive root — handles the case
  // where the user previously set up a workspace and later revoked app permissions.
  const existing = await drive.files.list({
    q: [
      `name = '${escapeDriveQueryValue(folderName)}'`,
      `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
      `'root' in parents`,
      'trashed = false',
    ].join(' and '),
    fields: 'files(id)',
    pageSize: 1,
  })

  const folderId = existing.data.files?.[0]?.id ?? await createDriveFolder({
    drive,
    name: folderName,
    parentId: 'root',
  })

  await updateUserDriveRootFolder(userId, folderId)
  return folderId
}

async function ensureRealGoogleDriveRootFolder(userId: string): Promise<string> {
  const user = await requireUser(userId)
  const drive = getDrive(user)

  const existing = await drive.files.list({
    q: [
      `name = '${escapeDriveQueryValue(env.googleDriveRootName)}'`,
      `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
      `'root' in parents`,
      'trashed = false',
    ].join(' and '),
    fields: 'files(id)',
    pageSize: 1,
  })

  const folderId = existing.data.files?.[0]?.id
  if (folderId) {
    return folderId
  }

  return createDriveFolder({ drive, name: env.googleDriveRootName, parentId: 'root' })
}

export async function ensureGoogleDocsExportFolder(userId: string, projectTitle: string): Promise<string> {
  if (!(await shouldUseLocalFileStorage(userId))) {
    const rootFolderId = await ensureUserDriveRootFolder(userId)
    return await ensureChildFolderInDrive(userId, rootFolderId, projectTitle)
  }

  const rootFolderId = await ensureRealGoogleDriveRootFolder(userId)
  const drive = getDrive(await requireUser(userId))
  const existing = await drive.files.list({
    q: [
      `name = '${escapeDriveQueryValue(projectTitle)}'`,
      `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
      `'${rootFolderId}' in parents`,
      'trashed = false',
    ].join(' and '),
    fields: 'files(id)',
    pageSize: 1,
  })

  const folderId = existing.data.files?.[0]?.id
  if (folderId) {
    return folderId
  }

  return createDriveFolder({ drive, name: projectTitle, parentId: rootFolderId })
}

export async function createProjectDriveFolder(userId: string, title: string): Promise<string> {
  if (await shouldUseLocalFileStorage(userId)) {
    const rootFolderId = await ensureUserDriveRootFolder(userId)
    const folderId = path.join(rootFolderId, `project-${slugify(title)}-${randomUUID()}`)
    await mkdir(folderId, { recursive: true })
    return folderId
  }

  const user = await requireUser(userId)
  const drive = getDrive(user)
  const rootFolderId = await ensureUserDriveRootFolder(userId)

  return createDriveFolder({ drive, name: title, parentId: rootFolderId })
}

export async function listDriveRootProjectFolders(userId: string): Promise<Array<{ id: string; name: string }>> {
  if (await shouldUseLocalFileStorage(userId)) {
    const rootFolderId = await ensureUserDriveRootFolder(userId)
    const entries = await safeReadDir(rootFolderId)
    return entries
      .filter((entry) => entry.isDirectory() && !isInternalEntry(entry.name))
      .map((entry) => ({ id: path.join(rootFolderId, entry.name), name: entry.name }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  const drive = getDrive(await requireUser(userId))
  const rootFolderId = await ensureUserDriveRootFolder(userId)
  const items = await listDriveChildren(drive, rootFolderId)

  return items
    .filter((item): item is typeof item & { id: string; name: string } =>
      item.mimeType === DRIVE_FOLDER_MIME_TYPE &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      !isInternalEntry(item.name),
    )
    .map((item) => ({ id: item.id, name: item.name }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function listDriveProjectTree(userId: string, rootFolderId: string): Promise<DriveTreeEntry[]> {
  if (await shouldUseLocalFileStorage(userId)) {
    return await listLocalProjectTree(rootFolderId)
  }

  const drive = getDrive(await requireUser(userId))
  return listDriveTreeEntries(drive, rootFolderId, '')
}

export async function createDriveFolderInDrive(userId: string, parentId: string, name: string): Promise<string> {
  if (await shouldUseLocalFileStorage(userId)) {
    const parentInfo = await resolveLocalContainer(parentId)
    const targetPath = path.join(parentInfo.rootPath, parentInfo.relativePath, name)
    await mkdir(targetPath, { recursive: true })
    return targetPath
  }

  const user = await requireUser(userId)
  const drive = getDrive(user)
  return createDriveFolder({ drive, name, parentId })
}

export async function ensureChildFolderInDrive(userId: string, parentId: string, name: string): Promise<string> {
  if (await shouldUseLocalFileStorage(userId)) {
    const parentInfo = await resolveLocalContainer(parentId)
    const targetPath = path.join(parentInfo.rootPath, parentInfo.relativePath, name)
    await mkdir(targetPath, { recursive: true })
    return targetPath
  }

  const user = await requireUser(userId)
  const drive = getDrive(user)
  const existing = await drive.files.list({
    q: [
      `name = '${escapeDriveQueryValue(name)}'`,
      `mimeType = '${DRIVE_FOLDER_MIME_TYPE}'`,
      `'${parentId}' in parents`,
      'trashed = false',
    ].join(' and '),
    fields: 'files(id)',
    pageSize: 1,
  })

  const folderId = existing.data.files?.[0]?.id
  if (folderId) {
    return folderId
  }

  return createDriveFolder({ drive, name, parentId })
 }

export async function renameDriveItem(userId: string, fileId: string, name: string): Promise<void> {
  if (await shouldUseLocalFileStorage(userId)) {
    const item = await getProjectFileByStorageId(fileId)
    if (!item) {
      // fileId is a project folder path — rename it and update the DB record
      const project = await getProjectByDriveFolderId(userId, fileId)
      if (project) {
        const uuidMatch = path.basename(fileId).match(/([0-9a-f-]{36})$/)
        const uuid = uuidMatch ? uuidMatch[1] : null
        const newBasename = uuid ? `project-${slugify(name)}-${uuid}` : `project-${slugify(name)}-${path.basename(fileId).split('-').pop()}`
        const newFolderPath = path.join(path.dirname(fileId), newBasename)
        if (fileId !== newFolderPath) {
          await rename(fileId, newFolderPath)
          await updateProjectDriveFolderId(project.id, newFolderPath)
        }
      }
      return
    }

    const currentPath = path.join(item.projectDriveFolderId, item.path)
    const targetPath = path.join(path.dirname(currentPath), name)
    await mkdir(path.dirname(targetPath), { recursive: true })
    if (currentPath !== targetPath) {
      await rename(currentPath, targetPath)
    }
    return
  }

  try {
    const drive = getDrive(await requireUser(userId))
    await drive.files.update({
      fileId,
      requestBody: { name },
      fields: 'id',
    })
  } catch (error) {
    throw mapDriveError(error)
  }
}

export async function moveDriveItem(input: {
  userId: string
  fileId: string
  name?: string
  parentId?: string
}): Promise<void> {
  if (await shouldUseLocalFileStorage(input.userId)) {
    const item = await getProjectFileByStorageId(input.fileId)
    if (!item) {
      return
    }

    const destination = await resolveLocalContainer(input.parentId ?? item.projectDriveFolderId)
    const targetName = input.name ?? item.name
    const currentPath = path.join(item.projectDriveFolderId, item.path)
    const sourcePath = await pathExists(currentPath) ? currentPath : input.fileId
    const targetPath = path.join(destination.rootPath, destination.relativePath, targetName)
    await mkdir(path.dirname(targetPath), { recursive: true })
    if (sourcePath !== targetPath) {
      await rename(sourcePath, targetPath)
    }
    return
  }

  const drive = getDrive(await requireUser(input.userId))
  const metadata = await drive.files.get({
    fileId: input.fileId,
    fields: 'parents',
  })

  const currentParents = metadata.data.parents ?? []
  const nextParentId = input.parentId ?? currentParents[0]
  const requestBody: drive_v3.Schema$File = {}
  if (input.name) {
    requestBody.name = input.name
  }

  await drive.files.update({
    fileId: input.fileId,
    addParents: nextParentId && !currentParents.includes(nextParentId) ? nextParentId : undefined,
    removeParents: nextParentId ? currentParents.filter((parentId) => parentId !== nextParentId).join(',') || undefined : undefined,
    requestBody: Object.keys(requestBody).length ? requestBody : undefined,
    fields: 'id',
  })
}

export async function deleteDriveItem(userId: string, fileId: string): Promise<void> {
  driveFileBufferCache.delete(fileId)
  if (await shouldUseLocalFileStorage(userId)) {
    const item = await getProjectFileByStorageId(fileId)
    if (item) {
      const currentPath = path.join(item.projectDriveFolderId, item.path)
      await rm(currentPath, { recursive: true, force: true })
      if (currentPath !== fileId) {
        await rm(fileId, { recursive: true, force: true })
      }
      return
    }

    await rm(fileId, { recursive: true, force: true })
    return
  }

  const drive = getDrive(await requireUser(userId))
  await drive.files.delete({ fileId })
}

export async function createGoogleDocInDrive(userId: string, parentId: string, name: string): Promise<string> {
  if (await shouldUseLocalFileStorage(userId)) {
    const parentInfo = await resolveLocalContainer(parentId)
    const targetPath = path.join(parentInfo.rootPath, parentInfo.relativePath, `${name}.gdoc`)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, JSON.stringify({ type: 'gdoc', name }), 'utf8')
    return targetPath
  }

  const drive = getDrive(await requireUser(userId))
  try {
    const response = await drive.files.create({
      requestBody: {
        name,
        parents: [parentId],
        mimeType: GOOGLE_DOC_MIME_TYPE,
      },
      fields: 'id',
    })

    const fileId = response.data.id
    if (!fileId) {
      throw new Error('Google Drive did not return a file ID')
    }

    return fileId
  } catch (error) {
    throw mapDriveError(error)
  }
}

export async function createTextFileInDrive(userId: string, parentId: string, name: string, content: string): Promise<string> {
  if (await shouldUseLocalFileStorage(userId)) {
    const parentInfo = await resolveLocalContainer(parentId)
    const targetPath = path.join(parentInfo.rootPath, parentInfo.relativePath, name)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content, 'utf8')
    return targetPath
  }

  return createFileInDrive({
    userId,
    parentId,
    name,
    mimeType: 'text/plain',
    body: Readable.from([content]),
  })
}

export async function createBinaryFileInDrive(input: {
  userId: string
  parentId: string
  name: string
  mimeType: string
  content: Buffer
}): Promise<string> {
  if (await shouldUseLocalFileStorage(input.userId)) {
    const parentInfo = await resolveLocalContainer(input.parentId)
    const targetPath = path.join(parentInfo.rootPath, parentInfo.relativePath, input.name)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, input.content)
    return targetPath
  }

  return createFileInDrive({
    userId: input.userId,
    parentId: input.parentId,
    name: input.name,
    mimeType: input.mimeType,
    body: Readable.from(input.content),
  })
}

async function createFileInDrive(input: {
  userId: string
  parentId: string
  name: string
  mimeType: string
  body: Readable
}): Promise<string> {
  const drive = getDrive(await requireUser(input.userId))
  try {
    const response = await drive.files.create({
      requestBody: {
        name: input.name,
        parents: [input.parentId],
        mimeType: input.mimeType,
      },
      media: {
        mimeType: input.mimeType,
        body: input.body,
      },
      fields: 'id',
    })

    const fileId = response.data.id
    if (!fileId) {
      throw new Error('Google Drive did not return a file ID')
    }

    return fileId
  } catch (error) {
    throw mapDriveError(error)
  }
}

export async function upsertBinaryFileInDrive(input: {
  userId: string
  parentId: string
  name: string
  mimeType: string
  content: Buffer
}): Promise<string> {
  if (await shouldUseLocalFileStorage(input.userId)) {
    const parentInfo = await resolveLocalContainer(input.parentId)
    const targetPath = path.join(parentInfo.rootPath, parentInfo.relativePath, input.name)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, input.content)
    return targetPath
  }

  const drive = getDrive(await requireUser(input.userId))
  try {
    const existing = await drive.files.list({
      q: [
        `name = '${escapeDriveQueryValue(input.name)}'`,
        `'${input.parentId}' in parents`,
        'trashed = false',
      ].join(' and '),
      fields: 'files(id)',
      pageSize: 1,
    })

    const existingFileId = existing.data.files?.[0]?.id

    if (existingFileId) {
      await drive.files.update({
        fileId: existingFileId,
        media: {
          mimeType: input.mimeType,
          body: Readable.from(input.content),
        },
        fields: 'id',
      })

      return existingFileId
    }

    const created = await drive.files.create({
      requestBody: {
        name: input.name,
        parents: [input.parentId],
        mimeType: input.mimeType,
      },
      media: {
        mimeType: input.mimeType,
        body: Readable.from(input.content),
      },
      fields: 'id',
    })

    const fileId = created.data.id
    if (!fileId) {
      throw new Error('Google Drive did not return a file ID')
    }

    return fileId
  } catch (error) {
    throw mapDriveError(error)
  }
}

export async function readTextFileFromDrive(userId: string, fileId: string): Promise<string> {
  return (await readFileBufferFromDrive(userId, fileId)).toString('utf8')
}

type DriveAccessError = Error & { code?: string; status?: number }

export async function readFileBufferFromDrive(userId: string, fileId: string): Promise<Buffer> {
  const cached = driveFileBufferCache.get(fileId)
  if (cached) {
    return cached
  }

  let buffer: Buffer
  if (await shouldUseLocalFileStorage(userId)) {
    const item = await getProjectFileByStorageId(fileId)
    if (!item) {
      try {
        buffer = await readLocalFileBuffer(fileId)
      } catch (error) {
        throw mapMissingLocalFileError(error, fileId)
      }
    } else {
      const targetPath = path.join(item.projectDriveFolderId, item.path)
      try {
        buffer = await readLocalFileBuffer(targetPath)
      } catch (error) {
        if (!isMissingLocalFileError(error) || !item.collaborationState || !isTextLikeFile(item.path, item.mimeType)) {
          throw mapMissingLocalFileError(error, item.path)
        }

        const content = decodeCollaborationState(item.collaborationState)
        await mkdir(path.dirname(targetPath), { recursive: true })
        await writeFile(targetPath, content, 'utf8')
        buffer = Buffer.from(content, 'utf8')
      }
    }
  } else {
    const drive = getDrive(await requireUser(userId))
    const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' })
    buffer = Buffer.from(response.data as ArrayBuffer)
  }

  driveFileBufferCache.set(fileId, buffer)
  return buffer
}

function isMissingLocalFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT')
}

function mapMissingLocalFileError(error: unknown, filePath: string): Error {
  if (!isMissingLocalFileError(error)) {
    return error instanceof Error ? error : new Error(String(error))
  }

  const notFoundError = new Error(`File content is unavailable for ${filePath}.`) as DriveAccessError
  notFoundError.code = 'drive_file_missing'
  notFoundError.status = 404
  return notFoundError
}

function isTextLikeFile(filePath: string, mimeType: string): boolean {
  if (mimeType.startsWith('text/')) {
    return true
  }

  return /\.(typ|tex|cls|sty|bib|txt|md|json|yaml|yml|csv|toml|xml|svg)$/i.test(filePath)
}

function decodeCollaborationState(state: Uint8Array): string {
  const document = new Y.Doc()
  Y.applyUpdate(document, state)
  return document.getText('content').toString()
}

function assertWithinLocalStorageRoot(targetPath: string): string {
  const root = path.resolve(env.localStorageRoot)
  const resolved = path.resolve(targetPath)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Access denied: path is outside local storage root`)
  }
  return resolved
}

async function readLocalFileBuffer(targetPath: string): Promise<Buffer> {
  const safePath = assertWithinLocalStorageRoot(targetPath)
  const info = await stat(safePath)
  if (info.isDirectory()) {
    throw new Error('Cannot load a folder as a file. Select a document file instead.')
  }

  return await readFile(safePath)
}

export async function writeTextFileToDrive(userId: string, fileId: string, content: string): Promise<void> {
  driveFileBufferCache.set(fileId, Buffer.from(content, 'utf8'))
  if (await shouldUseLocalFileStorage(userId)) {
    const item = await getProjectFileByStorageId(fileId)
    if (!item) {
      throw new Error('Local file not found')
    }

    const targetPath = path.join(item.projectDriveFolderId, item.path)
    await mkdir(path.dirname(targetPath), { recursive: true })
    await writeFile(targetPath, content, 'utf8')
    return
  }

  const drive = getDrive(await requireUser(userId))
  try {
    await drive.files.update({
      fileId,
      media: {
        mimeType: 'text/plain',
        body: Readable.from([content]),
      },
      fields: 'id',
    })
  } catch (error) {
    throw mapDriveError(error)
  }
}

export async function ensureDriveFilePublicUrl(userId: string, fileId: string): Promise<string> {
  if (await shouldUseLocalFileStorage(userId)) {
    return fileId
  }

  const drive = getDrive(await requireUser(userId))
  try {
    const permissions = await drive.permissions.list({
      fileId,
      fields: 'permissions(id,type,role)',
      pageSize: 100,
    })

    const hasPublicReader = (permissions.data.permissions ?? []).some((permission) => (
      permission.type === 'anyone' && (permission.role === 'reader' || permission.role === 'commenter' || permission.role === 'writer')
    ))

    if (!hasPublicReader) {
      await drive.permissions.create({
        fileId,
        requestBody: {
          type: 'anyone',
          role: 'reader',
        },
        fields: 'id',
      })
    }

    return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
  } catch (error) {
    throw mapDriveError(error)
  }
}

export async function ensureDriveItemPermission(input: {
  ownerUserId: string
  fileId: string
  email: string
  role: Exclude<ProjectRole, 'owner'>
}): Promise<string> {
  if (await shouldUseLocalFileStorage(input.ownerUserId)) {
    return `local-permission:${input.email.toLowerCase()}`
  }

  const drive = getDrive(await requireUser(input.ownerUserId))
  const targetRole = toDrivePermissionRole(input.role)
  const existing = await findDrivePermissionByEmail(drive, input.fileId, input.email)

  if (existing?.id) {
    if (existing.role !== targetRole) {
      await drive.permissions.update({
        fileId: input.fileId,
        permissionId: existing.id,
        requestBody: { role: targetRole },
        fields: 'id',
      })
    }

    return existing.id
  }

  const created = await drive.permissions.create({
    fileId: input.fileId,
    sendNotificationEmail: false,
    requestBody: {
      type: 'user',
      role: targetRole,
      emailAddress: input.email,
    },
    fields: 'id',
  })

  const permissionId = created.data.id
  if (!permissionId) {
    throw new Error('Google Drive did not return a permission ID')
  }

  return permissionId
}

export async function deleteDriveItemPermissionByEmail(input: {
  ownerUserId: string
  fileId: string
  email: string
}): Promise<boolean> {
  if (await shouldUseLocalFileStorage(input.ownerUserId)) {
    return true
  }

  const drive = getDrive(await requireUser(input.ownerUserId))
  const existing = await findDrivePermissionByEmail(drive, input.fileId, input.email)

  if (!existing?.id) {
    return false
  }

  await drive.permissions.delete({
    fileId: input.fileId,
    permissionId: existing.id,
  })

  return true
}

async function createDriveFolder(input: {
  drive: drive_v3.Drive
  name: string
  parentId: string
}): Promise<string> {
  try {
    const response = await input.drive.files.create({
      requestBody: {
        name: input.name,
        mimeType: DRIVE_FOLDER_MIME_TYPE,
        parents: [input.parentId],
      },
      fields: 'id',
    })

    const folderId = response.data.id
    if (!folderId) {
      throw new Error('Google Drive did not return a folder ID')
    }

    return folderId
  } catch (error) {
    throw mapDriveError(error)
  }
}

async function requireUser(userId: string): Promise<UserRecord> {
  const user = await findUserById(userId)
  if (!user) {
    throw new Error(`User ${userId} not found`)
  }

  return user
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/'/g, "\\'")
}

async function listDriveTreeEntries(drive: drive_v3.Drive, folderId: string, parentPath: string): Promise<DriveTreeEntry[]> {
  const children = await listDriveChildren(drive, folderId)
  const entries: DriveTreeEntry[] = []

  for (const child of children) {
    if (!child.id || !child.name || !child.mimeType) {
      continue
    }

    if (child.mimeType !== DRIVE_FOLDER_MIME_TYPE && child.mimeType.startsWith(GOOGLE_WORKSPACE_MIME_TYPE_PREFIX)) {
      continue
    }

    if (isInternalEntry(child.name)) {
      continue
    }

    const nextPath = parentPath ? `${parentPath}/${child.name}` : child.name
    entries.push({
      id: child.id,
      name: child.name,
      path: nextPath,
      mimeType: child.mimeType,
    })

    if (child.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      entries.push(...await listDriveTreeEntries(drive, child.id, nextPath))
    }
  }

  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

async function listDriveChildren(drive: drive_v3.Drive, parentId: string): Promise<drive_v3.Schema$File[]> {
  const items: drive_v3.Schema$File[] = []
  let pageToken: string | undefined

  do {
    const response = await drive.files.list({
      q: [`'${parentId}' in parents`, 'trashed = false'].join(' and '),
      fields: 'nextPageToken, files(id,name,mimeType)',
      orderBy: 'folder,name',
      pageSize: 1000,
      pageToken,
    })

    items.push(...(response.data.files ?? []))
    pageToken = response.data.nextPageToken ?? undefined
  } while (pageToken)

  return items
}

async function findDrivePermissionByEmail(
  drive: drive_v3.Drive,
  fileId: string,
  email: string,
): Promise<drive_v3.Schema$Permission | null> {
  const response = await drive.permissions.list({
    fileId,
    fields: 'permissions(id,emailAddress,role)',
  })

  return response.data.permissions?.find((permission) => permission.emailAddress?.toLowerCase() === email.toLowerCase()) ?? null
}

function toDrivePermissionRole(role: Exclude<ProjectRole, 'owner'>): 'reader' | 'writer' {
  return role === 'editor' ? 'writer' : 'reader'
}

async function resolveLocalContainer(storageId: string): Promise<{ rootPath: string; relativePath: string }> {
  if (await pathExists(storageId)) {
    const safePath = assertWithinLocalStorageRoot(storageId)
    return { rootPath: safePath, relativePath: '' }
  }

  const item = await getProjectFileByStorageId(storageId)
  if (!item) {
    throw new Error('Local storage target not found')
  }

  return {
    rootPath: item.projectDriveFolderId,
    relativePath: item.path,
  }
}

async function listLocalProjectTree(rootFolderId: string): Promise<DriveTreeEntry[]> {
  const entries: DriveTreeEntry[] = []
  await walkLocalTree(rootFolderId, '', entries)
  return entries.sort((left, right) => left.path.localeCompare(right.path))
}

async function walkLocalTree(rootPath: string, relativePath: string, entries: DriveTreeEntry[]): Promise<void> {
  const targetPath = relativePath ? path.join(rootPath, relativePath) : rootPath
  for (const entry of await safeReadDir(targetPath)) {
    if (isInternalEntry(entry.name)) {
      continue
    }

    const nextRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (shouldIgnoreLocalProjectEntry(nextRelativePath, entry.isDirectory())) {
      continue
    }

    const absolutePath = path.join(targetPath, entry.name)
    const directory = entry.isDirectory()
    entries.push({
      id: absolutePath,
      name: entry.name,
      path: nextRelativePath,
      mimeType: directory ? DRIVE_FOLDER_MIME_TYPE : inferMimeType(entry.name),
    })

    if (directory) {
      await walkLocalTree(rootPath, nextRelativePath, entries)
    }
  }
}

async function safeReadDir(targetPath: string) {
  try {
    return await readdir(targetPath, { withFileTypes: true })
  } catch {
    return []
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

function slugify(value: string): string {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized || 'project'
}

function inferMimeType(name: string): string {
  const extension = path.extname(name).toLowerCase()
  switch (extension) {
    case '.typ':
    case '.txt':
    case '.md':
    case '.json':
    case '.yaml':
    case '.yml':
    case '.toml':
    case '.bib':
    case '.csv':
    case '.svg':
    case '.tex':
    case '.ltx':
    case '.latex':
    case '.cls':
    case '.sty':
    case '.bst':
    case '.bbx':
    case '.cbx':
    case '.def':
    case '.clo':
    case '.cfg':
    case '.csl':
    case '.log':
    case '.aux':
    case '.bbl':
    case '.blg':
    case '.toc':
    case '.lof':
    case '.lot':
    case '.out':
    case '.idx':
    case '.ind':
    case '.ilg':
    case '.fls':
    case '.fdb_latexmk':
    case '.synctex':
      return 'text/plain'
    case '.pdf':
      return 'application/pdf'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    default:
      return 'application/octet-stream'
  }
}

function shouldIgnoreLocalProjectEntry(relativePath: string, directory: boolean): boolean {
  if (directory) {
    return false
  }

  return /\.(log|aux|bbl|blg|toc|lof|lot|out|idx|ind|ilg|fls|fdb_latexmk|synctex(?:\.gz)?)$/i.test(relativePath)
}
