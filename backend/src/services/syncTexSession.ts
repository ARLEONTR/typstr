import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { env } from '../env.js'

// A SyncTeX session keeps a per-compile working directory containing the PDF
// and `.synctex.gz`, so we can query them with the `synctex` CLI on demand for
// word-accurate forward/inverse search. Sessions are scoped to a user and
// evicted after TTL.

const SYNCTEX_TTL_MS = 15 * 60 * 1_000
const SYNCTEX_MAX_SESSIONS = parseInt(process.env.SYNCTEX_MAX_SESSIONS ?? '0', 10) || 256

interface SyncTexSessionState {
  token: string
  userId: string
  workDir: string
  pdfFileName: string
  syncTexFileName: string
  entryPath: string
  createdAt: number
  lastUsedAt: number
}

const sessions = new Map<string, SyncTexSessionState>()

function getSyncTexBaseDir(): string {
  const root = env.compileTmpdir || tmpdir()
  const baseDir = path.join(root, 'typstr-synctex-sessions')
  try {
    mkdirSync(baseDir, { recursive: true })
  } catch {}
  return baseDir
}

export interface CreateSyncTexSessionInput {
  userId: string
  entryPath: string
  pdfBuffer: Buffer
  syncTexBuffer: Buffer  // gzipped .synctex.gz contents
}

export function createSyncTexSession(input: CreateSyncTexSessionInput): string {
  const token = randomBytes(12).toString('hex')
  const baseDir = getSyncTexBaseDir()
  const workDir = mkdtempSync(path.join(baseDir, `${token}-`))
  const entryBaseName = path.basename(input.entryPath).replace(/\.[^.]+$/, '') || 'main'
  const pdfFileName = `${entryBaseName}.pdf`
  const syncTexFileName = `${entryBaseName}.synctex.gz`

  writeFileSync(path.join(workDir, pdfFileName), input.pdfBuffer)
  writeFileSync(path.join(workDir, syncTexFileName), input.syncTexBuffer)

  const state: SyncTexSessionState = {
    token,
    userId: input.userId,
    workDir,
    pdfFileName,
    syncTexFileName,
    entryPath: input.entryPath,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  }
  sessions.set(token, state)
  evictIfNeeded()
  return token
}

function evictIfNeeded(): void {
  const now = Date.now()
  for (const [token, state] of sessions) {
    if (now - state.lastUsedAt > SYNCTEX_TTL_MS) {
      destroySession(state)
      sessions.delete(token)
    }
  }
  while (sessions.size > SYNCTEX_MAX_SESSIONS) {
    let oldest: SyncTexSessionState | null = null
    for (const state of sessions.values()) {
      if (!oldest || state.lastUsedAt < oldest.lastUsedAt) {
        oldest = state
      }
    }
    if (!oldest) break
    destroySession(oldest)
    sessions.delete(oldest.token)
  }
}

function destroySession(state: SyncTexSessionState): void {
  try {
    rmSync(state.workDir, { recursive: true, force: true })
  } catch {}
}

setInterval(evictIfNeeded, 60_000).unref()

function getSession(token: string, userId: string): SyncTexSessionState | null {
  const state = sessions.get(token)
  if (!state || state.userId !== userId) {
    return null
  }
  if (!existsSync(state.workDir)) {
    sessions.delete(token)
    return null
  }
  state.lastUsedAt = Date.now()
  return state
}

export interface SyncTexEditResult {
  filePath: string
  line: number
  column: number | null
}

export interface SyncTexViewBox {
  page: number
  x: number
  y: number
  width: number
  height: number
  // Synctex also reports "h"/"v" - the horizontal anchor and vertical baseline
  // for the matched record. We surface them so the client can render a tight
  // highlight rather than the full bounding rectangle.
  h: number | null
  v: number | null
}

export interface SyncTexViewResult {
  boxes: SyncTexViewBox[]
}

// `synctex` CLI works in TeX big points (bp; 1 bp = 1/72 inch), whereas the
// raw `.synctex.gz` records (and therefore the parsed entries we send to the
// frontend) are in TeX scaled points (sp). 1 bp = 65536 sp. To keep the
// frontend coordinate system consistent (everything in sp), we convert at this
// API boundary: caller passes sp, we send bp to the CLI; CLI returns bp, we
// return sp to the caller.
const SP_PER_BP = 65536

export async function runSyncTexEdit(
  token: string,
  userId: string,
  query: { page: number; x: number; y: number },
): Promise<SyncTexEditResult | null> {
  const state = getSession(token, userId)
  if (!state) return null

  const pdfPath = path.join(state.workDir, state.pdfFileName)
  const bpX = query.x / SP_PER_BP
  const bpY = query.y / SP_PER_BP
  const arg = `${query.page}:${bpX}:${bpY}:${pdfPath}`
  const raw = await spawnSyncTex(['edit', '-o', arg], state.workDir)
  if (!raw) return null

  return parseSyncTexEditOutput(raw, state.workDir)
}

export async function runSyncTexView(
  token: string,
  userId: string,
  query: { filePath: string; line: number; column?: number | null },
): Promise<SyncTexViewResult | null> {
  const state = getSession(token, userId)
  if (!state) {
    console.warn('[SyncTeX] no session', { token: token.slice(0, 8), userId })
    return null
  }

  // The `Input:` records baked into `.synctex.gz` reference the absolute paths
  // from the *original* compile tmpDir, which we've already cleaned up. The
  // synctex CLI's file-matching logic falls back to basename comparison when
  // no exact path matches, so passing the basename of the requested project
  // file is the most reliable approach for our persisted-session setup.
  const basename = path.basename(query.filePath)
  const column = Number.isInteger(query.column ?? null) && (query.column ?? 0) > 0 ? `:${query.column}` : ''
  const pdfPath = path.join(state.workDir, state.pdfFileName)
  const arg = `${query.line}${column}:${basename}`
  const raw = await spawnSyncTex(['view', '-i', arg, '-o', pdfPath], state.workDir)
  if (!raw) {
    console.warn('[SyncTeX] CLI returned empty', { arg, workDir: state.workDir })
    return null
  }

  const parsed = parseSyncTexViewOutput(raw)
  if (!parsed) {
    console.warn('[SyncTeX] CLI output had no boxes', { arg, rawPreview: raw.slice(0, 200) })
  }
  return parsed
}

function spawnSyncTex(args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn('synctex', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    })
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      resolve(null)
    }, 5_000)

    proc.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))
    proc.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && chunks.length === 0) {
        resolve(null)
        return
      }
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
  })
}

function parseSyncTexEditOutput(raw: string, workDir: string): SyncTexEditResult | null {
  let inSection = false
  let filePath: string | null = null
  let line: number | null = null
  let column: number | null = null

  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.startsWith('SyncTeX result begin')) {
      inSection = true
      continue
    }
    if (rawLine.startsWith('SyncTeX result end')) {
      break
    }
    if (!inSection) continue

    const match = rawLine.match(/^([A-Za-z]+):\s*(.+)$/)
    if (!match) continue
    const key = match[1].toLowerCase()
    const value = match[2].trim()
    if (key === 'input') {
      filePath = value
    } else if (key === 'line') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) line = parsed
    } else if (key === 'column') {
      const parsed = Number(value)
      if (Number.isFinite(parsed) && parsed > 0) column = parsed
    }
  }

  if (!filePath || !line) return null

  const normalized = normalizeSyncTexFilePath(filePath, workDir)
  return { filePath: normalized, line, column: column ?? null }
}

function parseSyncTexViewOutput(raw: string): SyncTexViewResult | null {
  const boxes: SyncTexViewBox[] = []
  let inSection = false
  let current: Partial<SyncTexViewBox> = {}

  const flush = () => {
    if (
      typeof current.page === 'number'
      && typeof current.x === 'number'
      && typeof current.y === 'number'
      && typeof current.width === 'number'
      && typeof current.height === 'number'
    ) {
      boxes.push({
        page: current.page,
        x: current.x,
        y: current.y,
        width: current.width,
        height: current.height,
        h: typeof current.h === 'number' ? current.h : null,
        v: typeof current.v === 'number' ? current.v : null,
      })
    }
    current = {}
  }

  for (const rawLine of raw.split(/\r?\n/)) {
    if (rawLine.startsWith('SyncTeX result begin')) {
      inSection = true
      continue
    }
    if (rawLine.startsWith('SyncTeX result end')) {
      flush()
      break
    }
    if (!inSection) continue

    // Note: case matters here. The CLI emits lowercase `h:` (horizontal
    // anchor) and uppercase `H:` (box height), likewise `v:` vs `V:` and
    // `w:` vs `W:` (width). Lowercasing keys would conflate them and drop
    // height/width entirely.
    const match = rawLine.match(/^([A-Za-z]+):\s*(.+)$/)
    if (!match) continue
    const key = match[1]
    const value = match[2].trim()
    if (key === 'Output') {
      if (Object.keys(current).length > 0) {
        flush()
      }
      continue
    }
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) continue
    if (key === 'Page') current.page = numeric
    // CLI reports x/y/h/v/W/H in bp; convert to sp so the frontend coordinate
    // system stays consistent with the parsed entries.
    else if (key === 'x') current.x = numeric * SP_PER_BP
    else if (key === 'y') current.y = numeric * SP_PER_BP
    else if (key === 'h') current.h = numeric * SP_PER_BP
    else if (key === 'v') current.v = numeric * SP_PER_BP
    else if (key === 'W') current.width = numeric * SP_PER_BP
    else if (key === 'H') current.height = numeric * SP_PER_BP
  }

  return boxes.length === 0 ? null : { boxes }
}

function normalizeSyncTexFilePath(raw: string, workDir: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const absolute = path.isAbsolute(trimmed) ? trimmed : path.resolve(workDir, trimmed)
  const relative = path.relative(workDir, absolute).replace(/\\/g, '/')
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return path.basename(trimmed).replace(/\\/g, '/')
  }
  return relative
}
