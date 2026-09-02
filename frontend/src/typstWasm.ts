import init, { TypstCompilerBuilder } from '@myriaddreamin/typst-ts-web-compiler'
import wasmUrl from '@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url'
import { createTypstRenderer, type RenderSession, type TypstRenderer } from '@myriaddreamin/typst.ts'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url'
import liberationSansRegularUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf?url'
import liberationSansBoldUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf?url'
import liberationSansItalicUrl from 'pdfjs-dist/standard_fonts/LiberationSans-Italic.ttf?url'
import liberationSansBoldItalicUrl from 'pdfjs-dist/standard_fonts/LiberationSans-BoldItalic.ttf?url'
import { apiClient } from './api/client'

type ProjectFileEntry = { path: string; content: string | Uint8Array }
type PackageSpec = { namespace: string; name: string; version: string }
type PackageBundleResponse = {
  rootPath: string
  files: Array<{ path: string; contentBase64: string }>
}

export type TypstWasmSvgResult = {
  format: 'svg'
  pages: string[]
  pageCount: number
  pageOffset: number
}

export type TypstWasmPdfResult = {
  format: 'pdf'
  pdf: Uint8Array
}

type CompilerWithPackageState = {
  _packageBundleCache?: Map<string, Promise<PackageBundleResponse>>
  _mappedPackageRoots?: Set<string>
  _resolvedPackageRoots?: Map<string, string>
  _resolvedPackageAliases?: Map<string, string>
  _virtualFiles?: Map<string, Uint8Array>
  _workspaceFilePaths?: Set<string>
}

let isInitialized = false
let compiler: (Awaited<ReturnType<TypstCompilerBuilder['build']>> & CompilerWithPackageState) | null = null
let renderer: TypstRenderer | null = null
let compileChain: Promise<unknown> = Promise.resolve()
const DEFAULT_FONT_FETCH_TIMEOUT_MS = Number(import.meta.env.VITE_TYPST_FONT_FETCH_TIMEOUT_MS ?? 3500) || 3500

const BUNDLED_FONT_URLS = [
  liberationSansRegularUrl,
  liberationSansBoldUrl,
  liberationSansItalicUrl,
  liberationSansBoldItalicUrl,
]

function buildTypstTextFontUrls(): string[] {
  const baseUrl = 'https://cdn.jsdelivr.net/gh/typst/typst-assets@v0.13.1/files/fonts'
  return [
    'DejaVuSansMono-Bold.ttf',
    'DejaVuSansMono-BoldOblique.ttf',
    'DejaVuSansMono-Oblique.ttf',
    'DejaVuSansMono.ttf',
    'LibertinusSerif-Bold.otf',
    'LibertinusSerif-BoldItalic.otf',
    'LibertinusSerif-Italic.otf',
    'LibertinusSerif-Regular.otf',
    'LibertinusSerif-Semibold.otf',
    'LibertinusSerif-SemiboldItalic.otf',
    'NewCM10-Bold.otf',
    'NewCM10-BoldItalic.otf',
    'NewCM10-Italic.otf',
    'NewCM10-Regular.otf',
    'NewCMMath-Bold.otf',
    'NewCMMath-Book.otf',
    'NewCMMath-Regular.otf',
  ].map((fileName) => `${baseUrl}/${fileName}`)
}

async function ensureInitialized() {
  if (isInitialized) return
  await init({ module_or_path: wasmUrl })
  renderer = createTypstRenderer()
  await renderer.init({
    getWrapper: () => import('@myriaddreamin/typst-ts-renderer'),
    getModule: () => ({ module_or_path: rendererWasmUrl }) as unknown as WebAssembly.Module,
  })
  isInitialized = true
}

export async function getTypstCompiler() {
  await ensureInitialized()
  if (compiler) return compiler

  const packageBundleCache = new Map<string, Promise<PackageBundleResponse>>()
  const mappedPackageRoots = new Set<string>()
  const resolvedPackageRoots = new Map<string, string>()
  const resolvedPackageAliases = new Map<string, string>()
  const virtualFiles = new Map<string, Uint8Array>()
  const workspaceFilePaths = new Set<string>()
  const builder = new TypstCompilerBuilder()
  await loadDefaultFonts(builder)
  await builder.set_access_model(
    { virtualFiles },
    () => Date.now(),
    (path: string) => virtualFiles.has(normalizeVirtualPath(path)),
    (path: string) => normalizeVirtualPath(path),
    (path: string) => virtualFiles.get(normalizeVirtualPath(path)),
  )
  await builder.set_package_registry(
    { resolvedPackageRoots, resolvedPackageAliases },
    (spec: PackageSpec) => {
      const normalized = normalizePackageSpec(spec)
      return resolvedPackageRoots.get(packageCacheKey(normalized))
        ?? resolvedPackageAliases.get(packageAliasKey(normalized))
    },
  )
  compiler = await builder.build() as Awaited<ReturnType<TypstCompilerBuilder['build']>> & CompilerWithPackageState
  compiler._packageBundleCache = packageBundleCache
  compiler._mappedPackageRoots = mappedPackageRoots
  compiler._resolvedPackageRoots = resolvedPackageRoots
  compiler._resolvedPackageAliases = resolvedPackageAliases
  compiler._virtualFiles = virtualFiles
  compiler._workspaceFilePaths = workspaceFilePaths
  return compiler
}

async function loadDefaultFonts(builder: TypstCompilerBuilder): Promise<void> {
  // 1. First load local bundled fonts (guaranteed to succeed offline)
  const bundledBuffers = await Promise.allSettled(
    BUNDLED_FONT_URLS.map((url) => fetchFontBytes(url, 5000)),
  )
  let loadedCount = 0
  for (const result of bundledBuffers) {
    if (result.status === 'fulfilled') {
      await builder.add_raw_font(result.value)
      loadedCount++
    }
  }

  // 2. Best-effort load additional typography fonts from CDN with a short timeout
  const cdnUrls = buildTypstTextFontUrls()
  const cdnBuffers = await Promise.allSettled(
    cdnUrls.map((url) => fetchFontBytes(url, 2000)),
  )
  for (const result of cdnBuffers) {
    if (result.status === 'fulfilled') {
      await builder.add_raw_font(result.value)
      loadedCount++
    }
  }

  if (loadedCount === 0) {
    throw new Error('No Typst WebAssembly fonts were loaded.')
  }
}

async function fetchFontBytes(url: string, timeoutMs = DEFAULT_FONT_FETCH_TIMEOUT_MS): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: 'force-cache', signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Failed to load Typst WebAssembly font asset: ${url}`)
    }
    return new Uint8Array(await response.arrayBuffer())
  } finally {
    window.clearTimeout(timeout)
  }
}

const textEncoder = new TextEncoder()
const fileContentFingerprintMap = new Map<string, string>()
const packageExtractCache = new Map<string, PackageSpec[]>()

export function warmTypstWasmInBackground(): void {
  void getTypstCompiler().catch(() => undefined)
}

// Auto-warm compiler in background
if (typeof window !== 'undefined') {
  setTimeout(() => warmTypstWasmInBackground(), 100)
}

export async function compileTypstWasm(
  source: string,
  entryFilePath: string,
  files: ProjectFileEntry[],
): Promise<TypstWasmSvgResult> {
  return runExclusive(async () => {
    try {
      const compiler = await getTypstCompiler()
      const packageBundleCache = compiler._packageBundleCache || new Map<string, Promise<PackageBundleResponse>>()
      const mappedPackageRoots = compiler._mappedPackageRoots || new Set<string>()
      const resolvedPackageRoots = compiler._resolvedPackageRoots || new Map<string, string>()
      const resolvedPackageAliases = compiler._resolvedPackageAliases || new Map<string, string>()
      const virtualFiles = compiler._virtualFiles || new Map<string, Uint8Array>()
      const workspaceFilePaths = compiler._workspaceFilePaths || new Set<string>()

      const entryPath = normalizeVirtualPath(entryFilePath)
      const workspaceFiles = syncWorkspaceFiles(source, entryPath, files, virtualFiles, workspaceFilePaths)
      await preloadPackageBundles(workspaceFiles, packageBundleCache, mappedPackageRoots, resolvedPackageRoots, resolvedPackageAliases, virtualFiles)

      const rawResult = await compiler.compile(entryPath, [], 'vector', 0)
      const vectorArtifact = normalizeVectorArtifact(rawResult)
      const pages = await renderVectorArtifactToSvgPages(vectorArtifact)

      return {
        format: 'svg',
        pages,
        pageCount: pages.length,
        pageOffset: 0,
      }
    } catch (error) {
      if (isFatalTypstWasmError(error)) {
        resetTypstWasmState()
      }
      throw error
    }
  })
}

export async function compileTypstWasmToPdf(
  source: string,
  entryFilePath: string,
  files: ProjectFileEntry[],
): Promise<TypstWasmPdfResult> {
  return runExclusive(async () => {
    try {
      const compiler = await getTypstCompiler()
      const packageBundleCache = compiler._packageBundleCache || new Map<string, Promise<PackageBundleResponse>>()
      const mappedPackageRoots = compiler._mappedPackageRoots || new Set<string>()
      const resolvedPackageRoots = compiler._resolvedPackageRoots || new Map<string, string>()
      const resolvedPackageAliases = compiler._resolvedPackageAliases || new Map<string, string>()
      const virtualFiles = compiler._virtualFiles || new Map<string, Uint8Array>()
      const workspaceFilePaths = compiler._workspaceFilePaths || new Set<string>()

      const entryPath = normalizeVirtualPath(entryFilePath)
      const workspaceFiles = syncWorkspaceFiles(source, entryPath, files, virtualFiles, workspaceFilePaths)
      await preloadPackageBundles(workspaceFiles, packageBundleCache, mappedPackageRoots, resolvedPackageRoots, resolvedPackageAliases, virtualFiles)

      const rawResult = await compiler.compile(entryPath, [], 'pdf', 0)
      const pdfBytes = normalizePdfArtifact(rawResult)
      return {
        format: 'pdf',
        pdf: pdfBytes,
      }
    } catch (error) {
      if (isFatalTypstWasmError(error)) {
        resetTypstWasmState()
      }
      throw error
    }
  })
}

export function isFatalTypstWasmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  const stack = error instanceof Error ? error.stack ?? '' : ''
  const haystack = `${message}\n${stack}`

  return haystack.includes('tinymist-package')
    || haystack.includes('Option::unwrap()')
    || haystack.includes('called `Option::unwrap()` on a `None` value')
    || haystack.includes('panicked at ')
    || haystack.includes('browser.rs:')
    || haystack.includes('recursive use of an object detected')
    || haystack.includes('unsafe aliasing in rust')
}

export function resetTypstWasmState(): void {
  compiler = null
  renderer = null
  isInitialized = false
  fileContentFingerprintMap.clear()
  packageExtractCache.clear()
}

function normalizePackageSpec(spec: PackageSpec): PackageSpec {
  const normalized = {
    namespace: spec.namespace.trim(),
    name: spec.name.trim(),
    version: spec.version.trim(),
  }
  validatePackageSpec(normalized)
  return normalized
}

function validatePackageSpec(spec: PackageSpec): void {
  const IDENTIFIER_RE = /^[A-Za-z0-9._-]+$/
  const VERSION_RE = /^[A-Za-z0-9._+-]+$/
  if (!spec.namespace || !IDENTIFIER_RE.test(spec.namespace)) {
    throw new Error('Invalid Typst package namespace.')
  }
  if (!spec.name || !IDENTIFIER_RE.test(spec.name)) {
    throw new Error('Invalid Typst package name.')
  }
  if (!spec.version || !VERSION_RE.test(spec.version)) {
    throw new Error('Invalid Typst package version.')
  }
}

function packageCacheKey(spec: PackageSpec): string {
  return `${spec.namespace}/${spec.name}@${spec.version}`
}

function packageAliasKey(spec: PackageSpec): string {
  return `${spec.name}@${spec.version}`
}

async function preloadPackageBundles(
  workspaceFiles: ProjectFileEntry[],
  packageBundleCache: Map<string, Promise<PackageBundleResponse>>,
  mappedPackageRoots: Set<string>,
  resolvedPackageRoots: Map<string, string>,
  resolvedPackageAliases: Map<string, string>,
  virtualFiles: Map<string, Uint8Array>,
): Promise<void> {
  const pending = new Map<string, PackageSpec>()
  for (const file of workspaceFiles) {
    if (typeof file.content !== 'string') continue
    const fingerprint = fileContentFingerprintMap.get(file.path) || file.path
    let specs = packageExtractCache.get(fingerprint)
    if (!specs) {
      specs = extractPackageSpecs(file.content)
      packageExtractCache.set(fingerprint, specs)
    }
    for (const spec of specs) {
      pending.set(packageCacheKey(spec), spec)
    }
  }

  const processed = new Set<string>()
  while (pending.size > 0) {
    const [cacheKey, spec] = pending.entries().next().value as [string, PackageSpec]
    pending.delete(cacheKey)
    if (processed.has(cacheKey)) continue
    processed.add(cacheKey)

    const existingAliasRoot = resolvedPackageAliases.get(packageAliasKey(spec))
    if (existingAliasRoot) {
      resolvedPackageRoots.set(cacheKey, existingAliasRoot)
      continue
    }

    const bundle = await getPackageBundle(spec, packageBundleCache)
    const rootPath = normalizeVirtualPath(bundle.rootPath)
    if (!mappedPackageRoots.has(rootPath)) {
      mapPackageBundle(bundle, virtualFiles)
      mappedPackageRoots.add(rootPath)
    }
    resolvedPackageRoots.set(cacheKey, rootPath)
    resolvedPackageAliases.set(packageAliasKey(spec), rootPath)

    for (const file of bundle.files) {
      const content = tryDecodeBase64Text(file.contentBase64)
      if (!content) continue
      for (const dependencySpec of extractPackageSpecs(content)) {
        const dependencyCacheKey = packageCacheKey(dependencySpec)
        if (!processed.has(dependencyCacheKey)) {
          pending.set(dependencyCacheKey, dependencySpec)
        }
      }
    }
  }
}

async function getPackageBundle(
  spec: PackageSpec,
  packageBundleCache: Map<string, Promise<PackageBundleResponse>>,
): Promise<PackageBundleResponse> {
  const normalized = normalizePackageSpec(spec)
  const cacheKey = packageCacheKey(normalized)
  let bundlePromise = packageBundleCache.get(cacheKey)
  if (!bundlePromise) {
    bundlePromise = apiClient.get<PackageBundleResponse>(
      `/api/projects/typst-packages/${encodeURIComponent(normalized.namespace)}/${encodeURIComponent(normalized.name)}/${encodeURIComponent(normalized.version)}`,
      { timeout: 30_000 },
    ).then((response) => response.data)
    packageBundleCache.set(cacheKey, bundlePromise)
  }

  const bundle = await bundlePromise
  validatePackageBundle(bundle)
  return bundle
}

function extractPackageSpecs(content: string): PackageSpec[] {
  const specs: PackageSpec[] = []
  const PACKAGE_RE = /#(?:import|include)\s+"@([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+):([A-Za-z0-9._+-]+)"/g
  for (const match of content.matchAll(PACKAGE_RE)) {
    specs.push(normalizePackageSpec({
      namespace: match[1] ?? '',
      name: match[2] ?? '',
      version: match[3] ?? '',
    }))
  }
  return specs
}

function tryDecodeBase64Text(value: string): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(value))
  } catch {
    return null
  }
}

function validatePackageBundle(bundle: PackageBundleResponse): void {
  const normalizedRootPath = normalizeVirtualPath(bundle.rootPath || '')
  if (!normalizedRootPath.startsWith('/typst/packages/') || normalizedRootPath.includes('/../')) {
    throw new Error('Invalid Typst package root path.')
  }
  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error('Typst package bundle does not contain any files.')
  }
  for (const file of bundle.files) {
    if (!file || typeof file.path !== 'string' || !file.path.trim()) {
      throw new Error('Typst package bundle contains a file with missing path.')
    }
    const normalizedPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!normalizedPath || normalizedPath.includes('..')) {
      throw new Error(`Invalid Typst package file path: ${file.path}`)
    }
    if (typeof file.contentBase64 !== 'string' || !file.contentBase64.trim()) {
      throw new Error(`Typst package file content is missing for ${normalizedPath}`)
    }
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function normalizeVirtualPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/')
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

function syncWorkspaceFiles(
  source: string,
  entryPath: string,
  files: ProjectFileEntry[],
  virtualFiles: Map<string, Uint8Array>,
  workspaceFilePaths: Set<string>,
): ProjectFileEntry[] {
  const currentPaths = new Set<string>()
  const workspaceFiles: ProjectFileEntry[] = []

  // 1. Process entry file
  const normEntryPath = normalizeVirtualPath(entryPath)
  currentPaths.add(normEntryPath)
  const normSource = normalizeTypstSourceFonts(source)
  const entryFingerprint = `text:${normSource.length}:${normSource.slice(0, 32)}:${normSource.slice(-32)}`
  if (fileContentFingerprintMap.get(normEntryPath) !== entryFingerprint || !virtualFiles.has(normEntryPath)) {
    virtualFiles.set(normEntryPath, textEncoder.encode(normSource))
    fileContentFingerprintMap.set(normEntryPath, entryFingerprint)
  }
  workspaceFiles.push({ path: normEntryPath, content: normSource })

  // 2. Process other project files
  for (const file of files) {
    const normPath = normalizeVirtualPath(file.path)
    if (normPath === normEntryPath) continue
    currentPaths.add(normPath)

    if (typeof file.content === 'string') {
      const normContent = normalizeTypstSourceFonts(file.content)
      const fingerprint = `text:${normContent.length}:${normContent.slice(0, 32)}:${normContent.slice(-32)}`
      if (fileContentFingerprintMap.get(normPath) !== fingerprint || !virtualFiles.has(normPath)) {
        virtualFiles.set(normPath, textEncoder.encode(normContent))
        fileContentFingerprintMap.set(normPath, fingerprint)
      }
      workspaceFiles.push({ path: normPath, content: normContent })
    } else {
      const byteLen = file.content.byteLength
      const fingerprint = `bin:${byteLen}:${file.content[0] ?? 0}:${file.content[byteLen - 1] ?? 0}`
      if (fileContentFingerprintMap.get(normPath) !== fingerprint || !virtualFiles.has(normPath)) {
        virtualFiles.set(normPath, file.content)
        fileContentFingerprintMap.set(normPath, fingerprint)
      }
      workspaceFiles.push({ path: normPath, content: file.content })
    }
  }

  // 3. Remove deleted workspace files (preserve package files in /typst/packages/)
  for (const oldPath of workspaceFilePaths) {
    if (!currentPaths.has(oldPath)) {
      virtualFiles.delete(oldPath)
      fileContentFingerprintMap.delete(oldPath)
    }
  }
  workspaceFilePaths.clear()
  for (const path of currentPaths) {
    workspaceFilePaths.add(path)
  }

  return workspaceFiles
}

function mapPackageBundle(bundle: PackageBundleResponse, virtualFiles: Map<string, Uint8Array>): void {
  const rootPath = normalizeVirtualPath(bundle.rootPath)
  for (const file of bundle.files) {
    const normalizedFilePath = file.path.replace(/\\/g, '/').replace(/^\/+/, '')
    const targetPath = normalizeVirtualPath(`${rootPath}/${normalizedFilePath}`)
    if (!targetPath.startsWith(`${rootPath}/`)) {
      throw new Error(`Invalid Typst package file path after normalization: ${file.path}`)
    }

    if (virtualFiles.has(targetPath)) continue

    const maybeText = /\.(typ|typst)$/i.test(normalizedFilePath) ? tryDecodeBase64Text(file.contentBase64) : null
    virtualFiles.set(
      targetPath,
      maybeText !== null ? textEncoder.encode(normalizeTypstSourceFonts(maybeText)) : base64ToBytes(file.contentBase64),
    )
  }
}

function normalizeTypstSourceFonts(content: string): string {
  if (!content.includes('tex gyre') && !content.includes('TeX Gyre') && !content.includes('TEX GYRE')) {
    return content
  }
  return content
    .replace(/tex gyre termes/gi, 'Libertinus Serif')
    .replace(/tex gyre cursor/gi, 'DejaVu Sans Mono')
}

function normalizeSvgPages(result: unknown): string[] {
  if (Array.isArray(result)) {
    return result.map((page) => stringifySvgPage(page)).filter(Boolean)
  }

  if (typeof result === 'object' && result !== null) {
    const maybePages = (result as { pages?: unknown; content?: unknown }).pages
    if (Array.isArray(maybePages)) {
      return maybePages.map((page) => stringifySvgPage(page)).filter(Boolean)
    }

    const maybeContent = (result as { content?: unknown }).content
    if (Array.isArray(maybeContent)) {
      return maybeContent.map((page) => stringifySvgPage(page)).filter(Boolean)
    }
  }

  const page = stringifySvgPage(result)
  return page ? [page] : []
}

function stringifySvgPage(page: unknown): string {
  if (typeof page === 'string') {
    return page
  }

  if (page instanceof Uint8Array) {
    return new TextDecoder().decode(page)
  }

  if (typeof page === 'object' && page !== null && 'content' in page) {
    return stringifySvgPage((page as { content: unknown }).content)
  }

  return ''
}

function normalizeVectorArtifact(result: unknown): Uint8Array {
  if (result instanceof Uint8Array) {
    return result
  }

  if (typeof result === 'object' && result !== null && 'content' in result) {
    return normalizeVectorArtifact((result as { content: unknown }).content)
  }

  if (ArrayBuffer.isView(result)) {
    return new Uint8Array(result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength))
  }

  if (result instanceof ArrayBuffer) {
    return new Uint8Array(result)
  }

  throw new Error('Typst WebAssembly compiler did not return a vector artifact.')
}

function normalizePdfArtifact(result: unknown): Uint8Array {
  const bytes = normalizeVectorArtifact(result)
  if (bytes.length >= 4) {
    const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
    if (header === '%PDF') {
      return bytes
    }
  }

  throw new Error('Typst WebAssembly compiler did not return a PDF artifact.')
}

async function renderVectorArtifactToSvgPages(artifactContent: Uint8Array): Promise<string[]> {
  const activeRenderer = renderer
  if (!activeRenderer) {
    throw new Error('Typst SVG renderer is not initialized.')
  }

  const session = await (activeRenderer as TypstRenderer & {
    createModule: (artifact: Uint8Array) => Promise<RenderSession>
  }).createModule(artifactContent)

  try {
    const pageInfos = session.retrievePagesInfo()
    if (pageInfos.length === 0) {
      return []
    }

    const pages = await Promise.all(
      pageInfos.map((page) =>
        activeRenderer.renderSvg({
          renderSession: session,
          window: {
            lo: { x: 0, y: page.pageOffset },
            hi: { x: page.width, y: page.pageOffset + page.height },
          },
        }),
      ),
    )

    return normalizeSvgPages(pages)
  } finally {
    ;(session as RenderSession & { [Symbol.dispose]?: () => void; free?: () => void }).free?.()
  }
}

function runExclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = compileChain.then(task, task)
  compileChain = next.catch(() => undefined)
  return next
}
