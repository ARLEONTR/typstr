import path from 'node:path'
import type { ProjectFile } from '../types.js'

type MainFileCandidate = Pick<ProjectFile, 'id' | 'name' | 'path'>

const LATEX_DOCUMENTCLASS_RE = /\\documentclass(?:\s*\[[^\]]*])?\s*{/m

export function chooseAutomaticMainFile(
  files: MainFileCandidate[],
  contentByFileId: Map<string, string>,
): MainFileCandidate | null {
  const latexEntry = sortByEntryPriority(files.filter((file) => /\.tex$/i.test(file.name) && LATEX_DOCUMENTCLASS_RE.test(contentByFileId.get(file.id) ?? '')))[0]
  if (latexEntry) {
    return latexEntry
  }

  const typstEntries = files
    .filter((file) => /\.typ$/i.test(file.name))
    .map((file) => ({ file, score: scoreTypstMainFile(file, contentByFileId.get(file.id) ?? '') }))
    .sort((left, right) => right.score - left.score || compareEntryPriority(left.file, right.file))

  if (typstEntries[0]) {
    return typstEntries[0].file
  }

  return sortByEntryPriority(files.filter((file) => /\.tex$/i.test(file.name)))[0] ?? null
}

function scoreTypstMainFile(file: MainFileCandidate, content: string): number {
  const baseName = path.posix.basename(file.path, path.posix.extname(file.path)).toLowerCase()
  const depth = file.path.split('/').length - 1
  let score = Math.max(0, 20 - depth * 4)

  if (baseName === 'main') score += 100
  else if (baseName === 'manuscript') score += 80
  else if (baseName === 'paper' || baseName === 'article' || baseName === 'thesis' || baseName === 'report') score += 70
  else if (baseName === 'index' || baseName === 'root') score += 60

  if (/^#show\b/m.test(content)) score += 30
  if (/^#set\s+(document|page|text)\b/m.test(content)) score += 20
  if (/^#include\s+/m.test(content)) score += 15
  if (/^=\s+\S/m.test(content)) score += 10
  if (/^#bibliography\s*\(/m.test(content)) score += 5

  return score
}

function sortByEntryPriority<T extends MainFileCandidate>(files: T[]): T[] {
  return [...files].sort(compareEntryPriority)
}

function compareEntryPriority(left: MainFileCandidate, right: MainFileCandidate): number {
  return entryPriority(left) - entryPriority(right) || left.path.localeCompare(right.path)
}

function entryPriority(file: MainFileCandidate): number {
  const baseName = path.posix.basename(file.path, path.posix.extname(file.path)).toLowerCase()
  const depth = file.path.split('/').length - 1
  const nameRank = baseName === 'main'
    ? 0
    : baseName === 'manuscript'
      ? 1
      : baseName === 'paper' || baseName === 'article'
        ? 2
        : baseName === 'thesis' || baseName === 'report'
          ? 3
          : baseName === 'index' || baseName === 'root'
            ? 4
            : 10
  return nameRank * 100 + depth
}
