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

const DEFAULT_FONT_URLS = [
  liberationSansRegularUrl,
  liberationSansBoldUrl,
  liberationSansItalicUrl,
  liberationSansBoldItalicUrl,
  ...buildTypstTextFontUrls(),
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
  const settledBuffers = await Promise.allSettled(
    DEFAULT_FONT_URLS.map((url) => fetchFontBytes(url)),
  )

  const buffers: Uint8Array[] = []
  for (const result of settledBuffers) {
    if (result.status === 'fulfilled') {
      buffers.push(result.value)
    }
  }

  if (buffers.length === 0) {
    throw new Error('No Typst WebAssembly fonts were loaded.')
  }
  for (const buf of buffers) {
    await builder.add_raw_font(buf)
  }
}

async function fetchFontBytes(url: string): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), DEFAULT_FONT_FETCH_TIMEOUT_MS)
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
      clearWorkspaceFiles(virtualFiles, workspaceFilePaths)
      mappedPackageRoots.clear()
      resolvedPackageRoots.clear()
      resolvedPackageAliases.clear()

      const entryPath = normalizeVirtualPath(entryFilePath)
      const workspaceFiles = buildWorkspaceFiles(source, entryPath, files)
      mapWorkspaceFiles(workspaceFiles, virtualFiles, workspaceFilePaths)
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
      clearWorkspaceFiles(virtualFiles, workspaceFilePaths)
      mappedPackageRoots.clear()
      resolvedPackageRoots.clear()
      resolvedPackageAliases.clear()

      const entryPath = normalizeVirtualPath(entryFilePath)
      const workspaceFiles = buildWorkspaceFiles(source, entryPath, files)
      mapWorkspaceFiles(workspaceFiles, virtualFiles, workspaceFilePaths)
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
    for (const spec of extractPackageSpecs(file.content)) {
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

function buildWorkspaceFiles(
  source: string,
  entryPath: string,
  files: ProjectFileEntry[],
): ProjectFileEntry[] {
  const byPath = new Map<string, ProjectFileEntry>()
  for (const file of files) {
    byPath.set(normalizeVirtualPath(file.path), {
      path: normalizeVirtualPath(file.path),
      content: typeof file.content === 'string' ? normalizeTypstSourceFonts(file.content) : file.content,
    })
  }

  byPath.set(entryPath, {
    path: entryPath,
    content: normalizeTypstSourceFonts(source),
  })

  return [...byPath.values()]
}

function mapWorkspaceFiles(files: ProjectFileEntry[], virtualFiles: Map<string, Uint8Array>, workspaceFilePaths: Set<string>): void {
  const encoder = new TextEncoder()
  workspaceFilePaths.clear()
  for (const file of files) {
    const path = normalizeVirtualPath(file.path)
    virtualFiles.set(path, typeof file.content === 'string' ? encoder.encode(file.content) : file.content)
    workspaceFilePaths.add(path)
  }
}

function mapPackageBundle(bundle: PackageBundleResponse, virtualFiles: Map<string, Uint8Array>): void {
  const rootPath = normalizeVirtualPath(bundle.rootPath)
  for (const file of bundle.files) {
    const normalizedFilePath = file.path.replace(/\\/g, '/').replace(/^\/+/, '')
    const targetPath = normalizeVirtualPath(`${rootPath}/${normalizedFilePath}`)
    if (!targetPath.startsWith(`${rootPath}/`)) {
      throw new Error(`Invalid Typst package file path after normalization: ${file.path}`)
    }

    const maybeText = /\.(typ|typst)$/i.test(normalizedFilePath) ? tryDecodeBase64Text(file.contentBase64) : null
    virtualFiles.set(
      targetPath,
      maybeText !== null ? new TextEncoder().encode(normalizeTypstSourceFonts(maybeText)) : base64ToBytes(file.contentBase64),
    )
  }
}

function normalizeTypstSourceFonts(content: string): string {
  return content
    .replace(/tex gyre termes/gi, 'Libertinus Serif')
    .replace(/tex gyre cursor/gi, 'DejaVu Sans Mono')
}

function clearWorkspaceFiles(virtualFiles: Map<string, Uint8Array>, workspaceFilePaths: Set<string>): void {
  for (const path of workspaceFilePaths) {
    virtualFiles.delete(path)
  }
  workspaceFilePaths.clear()
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
