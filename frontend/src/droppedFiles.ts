export interface UploadItem {
  file: File
  /** Folder path relative to the drop target, or null for the target itself. */
  directory: string | null
}

export interface DroppedUpload {
  files: UploadItem[]
  /** Every folder in the drop (including empty ones), parents first. */
  folders: string[]
}

const IGNORED_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])
const IGNORED_FOLDERS = new Set(['.git', '.svn', '.hg', '__MACOSX', 'node_modules'])

function isIgnoredName(name: string): boolean {
  return IGNORED_NAMES.has(name.toLowerCase()) || name.startsWith('._')
}

function joinRelative(parent: string | null, name: string): string {
  return parent ? `${parent}/${name}` : name
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject))
}

async function readDirectoryEntries(entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = entry.createReader()
  const all: FileSystemEntry[] = []
  // readEntries returns at most ~100 entries per call; read until empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (batch.length === 0) return all
    all.push(...batch)
  }
}

async function walkEntry(entry: FileSystemEntry, directory: string | null, result: DroppedUpload): Promise<void> {
  if (entry.isFile) {
    if (isIgnoredName(entry.name)) return
    result.files.push({ file: await readEntryFile(entry as FileSystemFileEntry), directory })
    return
  }
  if (!entry.isDirectory || IGNORED_FOLDERS.has(entry.name)) return

  const folderPath = joinRelative(directory, entry.name)
  result.folders.push(folderPath)
  for (const child of await readDirectoryEntries(entry as FileSystemDirectoryEntry)) {
    await walkEntry(child, folderPath, result)
  }
}

/**
 * Collect the files of an external drop, descending into dropped folders.
 * Must be called synchronously inside the drop handler: the browser empties
 * the DataTransfer once the handler returns.
 */
export function collectDroppedFiles(dataTransfer: DataTransfer): Promise<DroppedUpload> {
  const entries = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
  const plainFiles = Array.from(dataTransfer.files)

  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return Promise.resolve({ files: plainFiles.map((file) => ({ file, directory: null })), folders: [] })
  }

  return (async () => {
    const result: DroppedUpload = { files: [], folders: [] }
    for (const entry of entries) {
      await walkEntry(entry!, null, result)
    }
    result.folders.sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right))
    return result
  })()
}

/** Run tasks with a fixed number in flight; resolves once all have settled. */
export async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]
      await task(item)
    }
  })
  await Promise.all(workers)
}
