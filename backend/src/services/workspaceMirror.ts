import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ProjectWorkspace, ProjectWorkspaceFile } from './projectWorkspace.js'

export interface MirroredWorkspace {
  dir: string
  entryFilePath: string
  resolvePath: (relativePath: string) => string
  dispose: () => void
}

export function createMirroredWorkspace(workspace: ProjectWorkspace, prefix = 'typstr-workspace-'): MirroredWorkspace {
  const baseDir = process.env.COMPILE_TMPDIR ?? '/tmp'
  mkdirSync(baseDir, { recursive: true })
  const dir = mkdtempSync(path.join(baseDir, prefix))
  syncMirroredWorkspace(dir, workspace.files)

  return {
    dir,
    entryFilePath: resolveWorkspacePath(dir, workspace.entryPath),
    resolvePath: (relativePath: string) => resolveWorkspacePath(dir, relativePath),
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}

export function syncMirroredWorkspace(dir: string, files: ProjectWorkspaceFile[]): void {
  mkdirSync(dir, { recursive: true })
  const expectedPaths = new Set(files.map((file) => resolveWorkspacePath(dir, file.path)))

  // 1. Remove files that are no longer expected
  for (const existingPath of listWorkspaceFiles(dir)) {
    const basename = path.basename(existingPath)
    const isProjectOwned = expectedPaths.has(existingPath)
    const isExternalFile = basename.startsWith('.') || basename.endsWith('.lock')
    if (!isProjectOwned && !isExternalFile) {
      unlinkSync(existingPath)
    }
  }

  // 2. Remove directories that are no longer expected (except dotfiles/lockfiles)
  cleanupEmptyDirectories(dir, expectedPaths)

  // 3. Write/update files, ensuring no directory conflicts
  for (const file of files) {
    const filePath = resolveWorkspacePath(dir, file.path)

    // Ensure the path is not a directory if we're about to write a file there
    const stats = statSafe(filePath)
    if (stats && stats.isDirectory()) {
      rmSync(filePath, { recursive: true, force: true })
    }

    // Ensure all parent components are directories (not files)
    const parentDir = path.dirname(filePath)
    ensureDirectory(parentDir)

    if (typeof file.content === 'string') {
      const existing = readFileSafe(filePath)
      if (existing !== null && existing.toString('utf8') === file.content) continue
      writeFileSync(filePath, file.content, 'utf8')
    } else {
      const existing = readFileSafe(filePath)
      if (existing !== null && existing.equals(file.content)) continue
      writeFileSync(filePath, file.content)
    }
  }
}

function ensureDirectory(dirPath: string): void {
  const stats = statSafe(dirPath)
  if (stats) {
    if (stats.isDirectory()) {
      return
    }
    rmSync(dirPath, { recursive: true, force: true })
  }
  const parent = path.dirname(dirPath)
  if (parent !== dirPath) {
    ensureDirectory(parent)
  }
  mkdirSync(dirPath, { recursive: true })
}

function cleanupEmptyDirectories(dir: string, expectedPaths: Set<string>): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.name.startsWith('.') || entry.name.endsWith('.lock')) continue

    cleanupEmptyDirectories(fullPath, expectedPaths)

    // After cleaning children, if the directory is now empty and not part of an expected path, remove it.
    // A directory is "part of an expected path" if any expected file path starts with it + '/'
    const isPrefixOfExpected = [...expectedPaths].some(p => p.startsWith(fullPath + path.sep))
    if (!isPrefixOfExpected && readdirSync(fullPath).length === 0) {
      rmSync(fullPath, { recursive: true, force: true })
    }
  }
}

export function resolveWorkspacePath(dir: string, relativePath: string): string {
  const normalized = path.normalize(relativePath).replace(/^([/\\])+/, '')
  if (!normalized || normalized.startsWith('..') || path.isAbsolute(normalized)) {
    throw new Error(`Invalid project file path: ${relativePath}`)
  }

  return path.join(dir, normalized)
}

function listWorkspaceFiles(dir: string): string[] {
  const result: string[] = []
  if (!statSafe(dir)?.isDirectory()) {
    return result
  }

  const stack = [dir]
  while (stack.length > 0) {
    const currentDir = stack.pop()!
    for (const entry of readdirSync(currentDir)) {
      const entryPath = path.join(currentDir, entry)
      const stats = statSafe(entryPath)
      if (!stats) {
        continue
      }
      if (stats.isDirectory()) {
        stack.push(entryPath)
      } else if (stats.isFile()) {
        result.push(entryPath)
      }
    }
  }

  return result
}

function statSafe(targetPath: string) {
  try {
    return statSync(targetPath)
  } catch {
    return null
  }
}

function readFileSafe(targetPath: string): Buffer | null {
  try {
    return readFileSync(targetPath)
  } catch {
    return null
  }
}
