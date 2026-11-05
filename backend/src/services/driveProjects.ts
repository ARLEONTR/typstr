import {
  createProject,
  createProjectFile,
  deleteProjectFile,
  deleteProjectFileTree,
  findUserById,
  getProjectByDriveFolderId,
  getProjectById,
  getProjectFileByDriveFileId,
  listProjectFiles,
  setProjectMainFile,
  syncLocalFileStorageIds,
  updateProjectFileMetadata,
  updateProjectFileStorageId,
  updateProjectTitle,
} from '../db.js'
import { DRIVE_FOLDER_MIME_TYPE, ensureUserDriveRootFolder, listDriveProjectTree, listDriveRootProjectFolders, readTextFileFromDrive, shouldUseLocalFileStorage } from './drive.js'
import { chooseAutomaticMainFile } from './projectMainFile.js'

const TRASH_PATH_PREFIX = 'Trash'
const SYNC_COOLDOWN_MS = 60_000
const lastSyncByUser = new Map<string, number>()

/** Run a full Drive sync only if the user hasn't synced within the cooldown window. Fire-and-forget safe. */
export function syncDriveProjectsForUserIfStale(userId: string): Promise<void> {
  const lastSync = lastSyncByUser.get(userId) ?? 0
  if (Date.now() - lastSync < SYNC_COOLDOWN_MS) {
    return Promise.resolve()
  }
  return syncDriveProjectsForUser(userId)
}

export async function syncDriveProjectsForUser(userId: string): Promise<void> {
  if (await shouldUseLocalFileStorage(userId)) {
    return
  }

  const user = await findUserById(userId)
  if (!user?.driveRootFolderId) {
    return
  }

  await ensureUserDriveRootFolder(userId)
  const driveFolders = await listDriveRootProjectFolders(userId)

  for (const driveFolder of driveFolders) {
    let project = await getProjectByDriveFolderId(userId, driveFolder.id)

    if (!project) {
      const createdProject = await createProject({
        ownerUserId: userId,
        title: driveFolder.name,
        driveFolderId: driveFolder.id,
      })
      project = await getProjectById(createdProject.id)
    } else if (project.title !== driveFolder.name) {
      await updateProjectTitle(project.id, driveFolder.name)
    }

    if (!project) {
      continue
    }

    await syncDriveProjectTree(project.id, userId, driveFolder.id)
  }

  lastSyncByUser.set(userId, Date.now())
}

export async function syncDriveProjectTree(projectId: string, ownerUserId: string, driveFolderId?: string): Promise<void> {
  const project = driveFolderId ? await getProjectByDriveFolderId(ownerUserId, driveFolderId) : await getProjectById(projectId)
  if (!project) {
    return
  }

  // With local file storage the database is the record of a project's files
  // and the folder holds their content, so the folder is matched by path and
  // the sync only adopts files that have no row; it never deletes rows. It
  // used to delete every row it could not match by storage id, and that id
  // went stale whenever a file was moved or renamed or its project renamed:
  // opening the project as its owner dropped those files, with their
  // comments, suggestions and revisions, and re-created them as new files.
  const localStorage = await shouldUseLocalFileStorage(ownerUserId)
  const nextEntries = (await listDriveProjectTree(ownerUserId, driveFolderId ?? project.driveFolderId))
    .filter((entry) => entry.path !== TRASH_PATH_PREFIX && !entry.path.startsWith(`${TRASH_PATH_PREFIX}/`))
  const currentFiles = await listProjectFiles(project.id)
  const currentByDriveId = new Map(currentFiles.map((file) => [file.driveFileId, file] as const))
  const currentByPath = new Map(currentFiles.map((file) => [file.path, file] as const))
  const seenFileIds = new Set<string>()

  for (const entry of nextEntries) {
    if (localStorage) {
      const existingFile = currentByPath.get(entry.path)
      if (existingFile) {
        seenFileIds.add(existingFile.id)
        if (existingFile.driveFileId !== entry.id) {
          await updateProjectFileStorageId(existingFile.id, entry.id)
        }
        continue
      }
      // A row elsewhere still carrying this location as its stale id would
      // share it with the adopted file; point it at its own path first.
      const staleIdHolder = currentByDriveId.get(entry.id)
      if (staleIdHolder) {
        await syncLocalFileStorageIds([staleIdHolder.id])
      }
    }

    const existingFile = localStorage ? undefined : currentByDriveId.get(entry.id)
    if (!existingFile) {
      // A row that already has this path is updated, not added: it is this entry now.
      const created = await createProjectFile({
        projectId: project.id,
        name: entry.name,
        path: entry.path,
        mimeType: entry.mimeType,
        driveFileId: entry.id,
      })
      seenFileIds.add(created.id)
      continue
    }

    seenFileIds.add(existingFile.id)
    if (existingFile.name !== entry.name || existingFile.path !== entry.path || existingFile.mimeType !== entry.mimeType) {
      await updateProjectFileMetadata(existingFile.id, {
        name: entry.name,
        path: entry.path,
        mimeType: entry.mimeType,
      })
    }
  }

  if (localStorage) {
    await ensureProjectMainFile(project.id)
    return
  }

  const staleFiles = currentFiles
    .filter((file) => !seenFileIds.has(file.id))
    .filter((file) => file.path !== TRASH_PATH_PREFIX && !file.path.startsWith(`${TRASH_PATH_PREFIX}/`))
    .sort((left, right) => right.path.length - left.path.length)

  const deletedPaths = new Set<string>()
  for (const staleFile of staleFiles) {
    const isNestedUnderDeletedFolder = [...deletedPaths].some((deletedPath) => staleFile.path.startsWith(`${deletedPath}/`))
    if (isNestedUnderDeletedFolder) {
      continue
    }

    if (staleFile.mimeType === DRIVE_FOLDER_MIME_TYPE) {
      await deleteProjectFileTree(staleFile.id)
      deletedPaths.add(staleFile.path)
      continue
    }

    await deleteProjectFile(staleFile.id)
  }

  await ensureProjectMainFile(project.id)
}

async function ensureProjectMainFile(projectId: string): Promise<void> {
  const project = await getProjectById(projectId)
  if (!project) {
    return
  }

  const files = await listProjectFiles(projectId)
  const mainFileStillExists = project.mainFileId ? files.some((file) => file.id === project.mainFileId) : false
  if (mainFileStillExists) {
    return
  }

  const candidateFiles = files.filter((file) => file.mimeType !== DRIVE_FOLDER_MIME_TYPE && /\.(typ|tex)$/i.test(file.name))
  const contentByFileId = new Map<string, string>()
  await Promise.all(candidateFiles.map(async (file) => {
    try {
      contentByFileId.set(file.id, await readTextFileFromDrive(project.ownerUserId, file.driveFileId))
    } catch {
      contentByFileId.set(file.id, '')
    }
  }))

  const fallbackMainFile = chooseAutomaticMainFile(candidateFiles, contentByFileId)
  await setProjectMainFile(projectId, fallbackMainFile?.id ?? null)
}
