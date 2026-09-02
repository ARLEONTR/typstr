import { BusyTexRunner, LuaLatex, PdfLatex, XeLatex } from 'texlyre-busytex'

export type LatexEngine = 'xelatex' | 'pdflatex' | 'lualatex'

interface CompileLatexOptions {
  engine?: LatexEngine
  busytexBasePath?: string
  remoteEndpoint?: string | null
  bibtex?: boolean
  rerun?: boolean
  entryPath?: string
  additionalFiles?: Array<{ path: string; content: string | Uint8Array }>
}

export interface LatexCompileResult {
  pdf: Uint8Array
  log: string | null
}

let runnerPromise: Promise<BusyTexRunner> | null = null
let runnerBasePath: string | null = null
let runnerReadyBasePath: string | null = null
let warmupPromise: Promise<void> | null = null
const patchedWorkerUrlByBasePath = new Map<string, Promise<string>>()
const DEFAULT_BUSYTEX_REMOTE_ENDPOINT = 'https://texlive2026.texlyre.org'

function resolveBusytexBasePath(override?: string): string {
  if (override && override.trim()) {
    return override.trim().replace(/\/+$/, '')
  }

  const envPath = import.meta.env.VITE_BUSYTEX_BASE_PATH
  if (typeof envPath === 'string' && envPath.trim()) {
    return envPath.trim().replace(/\/+$/, '')
  }

  return '/core/busytex'
}

function resolveBusytexRemoteEndpoint(override?: string | null): string | undefined {
  if (override !== undefined) {
    return normalizeBusytexRemoteEndpoint(override)
  }

  const envEndpoint = import.meta.env.VITE_BUSYTEX_REMOTE_ENDPOINT
  if (typeof envEndpoint === 'string') {
    return normalizeBusytexRemoteEndpoint(envEndpoint)
  }

  return DEFAULT_BUSYTEX_REMOTE_ENDPOINT
}

function normalizeBusytexRemoteEndpoint(endpoint?: string | null): string | undefined {
  const trimmed = endpoint?.trim()
  if (!trimmed || ['0', 'false', 'local', 'none', 'off'].includes(trimmed.toLowerCase())) {
    return undefined
  }

  return trimmed.replace(/\/+$/, '')
}

async function resolveAvailableBusytexBasePath(override?: string): Promise<string> {
  const preferred = resolveBusytexBasePath(override)
  const candidates = dedupeBusytexPaths([
    preferred,
    normalizeBusytexPath('/core/busytex'),
    normalizeBusytexPath(`${import.meta.env.BASE_URL || '/'}core/busytex`),
    typeof window !== 'undefined'
      ? normalizeBusytexPath(new URL('core/busytex', window.location.origin + ensureTrailingSlash(import.meta.env.BASE_URL || '/')).pathname)
      : null,
  ])

  for (const candidate of candidates) {
    if (await busytexAssetExists(candidate)) {
      return candidate
    }
  }

  return preferred
}

function dedupeBusytexPaths(paths: Array<string | null | undefined>): string[] {
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const path of paths) {
    if (!path) {
      continue
    }
    const normalized = normalizeBusytexPath(path)
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    deduped.push(normalized)
  }
  return deduped
}

function normalizeBusytexPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return '/core/busytex'
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

async function busytexAssetExists(basePath: string): Promise<boolean> {
  try {
    const response = await fetch(`${basePath}/versions.txt`, { cache: 'no-store' })
    if (!response.ok) return false
    const text = await response.text()
    return !text.trimStart().startsWith('<')
  } catch {
    return false
  }
}


async function getRunner(basePath: string): Promise<BusyTexRunner> {
  if (!runnerPromise || runnerBasePath !== basePath) {
    runnerBasePath = basePath
    runnerReadyBasePath = null
    runnerPromise = (async () => {
      const dataPackages = busytexDataPackageUrls(basePath)
      const runner = new BusyTexRunner({
        busytexBasePath: basePath,
        verbose: false,
        preloadDataPackages: [dataPackages.basic],
        catalogDataPackages: dataPackages.all,
      })
      installPatchedBusytexWorker(runner, basePath, dataPackages)
      await runner.initialize(true)
      runnerReadyBasePath = basePath
      return runner
    })().catch((error) => {
      runnerPromise = null
      runnerBasePath = null
      runnerReadyBasePath = null
      throw error
    })
  }

  return runnerPromise
}

function busytexDataPackageUrls(basePath: string): { basic: string; all: string[] } {
  const normalizedBasePath = basePath.replace(/\/+$/, '')
  const basic = toAbsoluteBrowserUrl(`${normalizedBasePath}/texlive-basic.js`)
  const allPackages = [
    `${normalizedBasePath}/texlive-basic.js`,
    `${normalizedBasePath}/texlive-recommended.js`,
    `${normalizedBasePath}/texlive-extra.js`,
  ].map(toAbsoluteBrowserUrl)

  return {
    basic,
    all: shouldAllowLargeBusytexDataPackages() ? allPackages : [basic],
  }
}

function toAbsoluteBrowserUrl(url: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) {
    return url
  }

  if (typeof window === 'undefined') {
    return url
  }

  return new URL(url, window.location.origin).href
}

function shouldSkipBusytexWarmup(): boolean {
  if (typeof navigator === 'undefined') {
    return true
  }

  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string }
  }).connection

  if (connection?.saveData) {
    return true
  }

  const effectiveType = connection?.effectiveType?.toLowerCase()
  return effectiveType === 'slow-2g' || effectiveType === '2g'
}

async function fetchBusytexWarmupAsset(url: string): Promise<void> {
  const response = await fetch(url, { cache: 'force-cache', priority: 'low' } as RequestInit & { priority?: 'low' })
  if (!response.ok) {
    throw new Error(`Failed to warm BusyTeX asset ${url}: ${response.status}`)
  }

  await response.arrayBuffer()
}

function shouldPreloadExtraBusytexPackages(): boolean {
  const value = import.meta.env.VITE_BUSYTEX_PRELOAD_EXTRA_PACKAGES
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function shouldAllowLargeBusytexDataPackages(): boolean {
  const value = import.meta.env.VITE_BUSYTEX_ALLOW_LARGE_DATA_PACKAGES
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

export function isBusytexRunnerReady(): boolean {
  return Boolean(runnerPromise && runnerReadyBasePath)
}

export function warmBusytexAssetsInBackground(basePathOverride?: string): Promise<void> {
  if (warmupPromise) {
    return warmupPromise
  }

  warmupPromise = (async () => {
    if (shouldSkipBusytexWarmup()) {
      return
    }

    const basePath = await resolveAvailableBusytexBasePath(basePathOverride)
    const normalizedBasePath = basePath.replace(/\/+$/, '')
    const dataPackages = busytexDataPackageUrls(basePath)
    await fetchBusytexWarmupAsset(toAbsoluteBrowserUrl(`${normalizedBasePath}/versions.txt`))
    await Promise.all([
      fetchBusytexWarmupAsset(toAbsoluteBrowserUrl(`${normalizedBasePath}/busytex.js`)),
      fetchBusytexWarmupAsset(toAbsoluteBrowserUrl(`${normalizedBasePath}/busytex.wasm`)),
      fetchBusytexWarmupAsset(toAbsoluteBrowserUrl(`${normalizedBasePath}/busytex_pipeline.js`)),
      fetchBusytexWarmupAsset(dataPackages.basic),
    ])
    await getRunner(basePath)

    // Keep background preparation intentionally small. The recommended/extra
    // package bundles are large, and warming them eagerly makes the network
    // look like it is downloading BusyTeX forever after the first LaTeX compile.
    if (shouldPreloadExtraBusytexPackages()) {
      await Promise.allSettled(
        dataPackages.all
          .filter((url) => url !== dataPackages.basic)
          .map((url) => fetchBusytexWarmupAsset(url)),
      )
    }
  })().catch((error) => {
    warmupPromise = null
    throw error
  })

  return warmupPromise
}

function installPatchedBusytexWorker(
  runner: BusyTexRunner,
  basePath: string,
  dataPackages: { basic: string; all: string[] },
): void {
  const patchedRunner = runner as any as {
    worker?: Worker | null
    initializeWorker?: () => Promise<void>
  }

  patchedRunner.initializeWorker = () => initializePatchedBusytexWorker(patchedRunner, basePath, dataPackages)
}

async function initializePatchedBusytexWorker(
  runner: { worker?: Worker | null },
  basePath: string,
  dataPackages: { basic: string; all: string[] },
): Promise<void> {
  const workerUrl = await getPatchedBusytexWorkerUrl(basePath)

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl)
    runner.worker = worker

    const timeout = window.setTimeout(() => {
      reject(new Error('Timeout waiting for BusyTeX worker to initialize'))
    }, 120_000)

    worker.onmessage = ({ data }) => {
      if (data.initialized) {
        window.clearTimeout(timeout)
        resolve()
      } else if (data.exception) {
        window.clearTimeout(timeout)
        reject(new Error(data.exception))
      }
    }

    worker.onerror = (error) => {
      window.clearTimeout(timeout)
      reject(new Error(`Worker error: ${error.message}`))
    }

    worker.postMessage({
      busytex_js: toAbsoluteBrowserUrl(`${basePath}/busytex.js`),
      busytex_wasm: toAbsoluteBrowserUrl(`${basePath}/busytex.wasm`),
      preload_data_packages_js: [dataPackages.basic],
      data_packages_js: dataPackages.all,
      texmf_local: [],
      preload: true,
    })
  })
}

function getPatchedBusytexWorkerUrl(basePath: string): Promise<string> {
  const normalizedBasePath = basePath.replace(/\/+$/, '')
  let promise = patchedWorkerUrlByBasePath.get(normalizedBasePath)
  if (!promise) {
    promise = createPatchedBusytexWorkerUrl(normalizedBasePath).catch((err) => {
      patchedWorkerUrlByBasePath.delete(normalizedBasePath)
      throw err
    })
    patchedWorkerUrlByBasePath.set(normalizedBasePath, promise)
  }
  return promise
}

async function createPatchedBusytexWorkerUrl(basePath: string): Promise<string> {
  const pipelineResponse = await fetch(`${basePath}/busytex_pipeline.js`, { cache: 'force-cache' })
  if (!pipelineResponse.ok) {
    throw new Error(`Failed to fetch BusyTeX pipeline: ${pipelineResponse.status}`)
  }

  let pipelineText = await pipelineResponse.text()
  if (pipelineText.trimStart().startsWith('<')) {
    const retryResponse = await fetch(`${basePath}/busytex_pipeline.js`, { cache: 'reload' })
    if (!retryResponse.ok) {
      throw new Error(`Failed to fetch BusyTeX pipeline: ${retryResponse.status}`)
    }
    pipelineText = await retryResponse.text()
    if (pipelineText.trimStart().startsWith('<')) {
      throw new Error(`Failed to fetch BusyTeX pipeline from ${basePath}/busytex_pipeline.js: received HTML instead of JavaScript`)
    }
  }

  const pipelineSource = patchBusytexPipelineSource(pipelineText)
  const workerSource = `${pipelineSource}

self.pipeline = null;

const patchBusytexEngineSource = ${patchBusytexEngineSource.toString()};
const busytexScriptPromises = new Map();

function toAbsoluteWorkerUrl(src) {
  if (!src || /^[a-z][a-z\\d+.-]*:/i.test(src)) {
    return src;
  }

  return new URL(src, self.location.origin).href;
}

function createBusytexScriptLoader() {
  const isVsCodeLikeRuntime = typeof navigator !== 'undefined' && /vscode|electron/i.test(navigator.userAgent || '');

  return (src) => {
    const absoluteSrc = toAbsoluteWorkerUrl(src);
    if (!src || !src.endsWith('/busytex.js')) {
      return Promise.resolve(self.importScripts(absoluteSrc));
    }

    if (isVsCodeLikeRuntime) {
      return Promise.resolve(self.importScripts(absoluteSrc));
    }

    let promise = busytexScriptPromises.get(absoluteSrc);
    if (!promise) {
      promise = fetch(absoluteSrc, { cache: 'force-cache' }).then(response => {
        if (!response.ok) {
          throw new Error('Failed to fetch BusyTeX engine: ' + response.status);
        }
        return response.text();
      }).then(source => {
        if (source.trimStart().startsWith('<')) {
          throw new Error('Failed to fetch BusyTeX engine from ' + absoluteSrc + ': received HTML instead of JavaScript');
        }
        (0, eval)(patchBusytexEngineSource(source));
      });
      busytexScriptPromises.set(absoluteSrc, promise);
    }
    return promise;
  };
}

function shouldSuppressBusytexStatusMessage(msg) {
  const text = String(msg || '');
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  return !msg
    || lower.indexOf('downloading data...') !== -1
    || lower.indexOf('/bin/busytex stdout:') !== -1
    || lower.indexOf('/bin/busytex stderr:') !== -1
    || lower.indexOf('still waiting on run dependencies') !== -1
    || lower === 'dependency: datafile_build/wasm/texlive-basic.data'
    || lower === 'dependency: datafile_build/wasm/texlive-recommended.data'
    || lower === 'dependency: datafile_build/wasm/texlive-extra.data'
    || trimmed.endsWith('(end of list)');
}

onmessage = async ({ data: { files, main_tex_path, bibtex, makeindex, rerun, busytex_wasm, busytex_js, preload_data_packages_js, data_packages_js, texmf_local, preload, verbose, driver, remote_endpoint, read_project_files, write_texlive_remote_files, write_texlive_remote_misses } }) => {
  if (busytex_wasm && busytex_js && preload_data_packages_js) {
    try {
      self.pipeline = new BusytexPipeline(busytex_js, busytex_wasm, data_packages_js, preload_data_packages_js, texmf_local, msg => { if (!shouldSuppressBusytexStatusMessage(msg)) postMessage({ print: msg }); }, applet_versions => postMessage({ initialized: applet_versions }), preload, createBusytexScriptLoader());
    } catch (err) {
      postMessage({ exception: 'Exception during initialization: ' + err.toString() + '\\nStack:\\n' + err.stack });
    }
  } else if (read_project_files && self.pipeline) {
    try {
      postMessage({ project_files: await self.pipeline.read_project_files(read_project_files.dir || null) });
    } catch (err) {
      postMessage({ exception: 'Exception reading project files: ' + err.toString() + '\\nStack:\\n' + err.stack });
    }
  } else if (write_texlive_remote_files && self.pipeline) {
    try {
      await self.pipeline.write_texlive_remote_files(write_texlive_remote_files);
      postMessage({ texlive_remote_written: true });
    } catch (err) {
      postMessage({ exception: 'Exception writing remote files: ' + err.toString() + '\\nStack:\\n' + err.stack });
    }
  } else if (write_texlive_remote_misses && self.pipeline) {
    try {
      await self.pipeline.write_texlive_remote_misses(write_texlive_remote_misses);
      postMessage({ texlive_remote_misses_written: true });
    } catch (err) {
      postMessage({ exception: 'Exception writing remote misses: ' + err.toString() + '\\nStack:\\n' + err.stack });
    }
  } else if (files && self.pipeline) {
    try {
      postMessage(await self.pipeline.compile(files, main_tex_path, bibtex, makeindex, rerun, verbose, driver, data_packages_js, remote_endpoint));
    } catch (err) {
      postMessage({ exception: 'Exception during compilation: ' + err.toString() + '\\nStack:\\n' + err.stack });
    }
  }
};
`

  return URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
}

function patchBusytexPipelineSource(source: string): string {
  return source
    .replace(
      'this.data_packages = data_packages_js.map(data_package_js => [data_package_js, fetch(data_package_js).then(r => r.text()).then(data_package_js_script => new Set(Array.from(data_package_js_script.matchAll(this.regex_providespackage)).map(groups => groups[1].toLowerCase().trim())))]);',
      'this.data_packages = data_packages_js.map(data_package_js => [data_package_js, fetch(data_package_js + \'.providespackage.txt\', { cache: \'force-cache\' }).then(r => r.ok ? r.text() : fetch(data_package_js, { cache: \'force-cache\' }).then(r => r.text())).then(data_package_js_script => new Set(Array.from(data_package_js_script.matchAll(this.regex_providespackage)).filter(groups => groups.length >= 2).map(groups => groups[1].toLowerCase().trim())))]);',
    )
    .replace(
      'this.regex_usepackage = /\\\\usepackage(\\[.*?\\])?\\{(.+?)\\}/g;',
      'this.regex_usepackage = /\\\\usepackage(\\[.*?\\])?\\{(.+?)\\}/g;\n        this.regex_documentclass = /\\\\documentclass(\\[.*?\\])?\\{(.+?)\\}/g;',
    )
    .replace(
      'this.regex_providespackage = /\\\\ProvidesPackage\\{(.+?)\\}(\\[.*?\\])?/g;',
      'this.regex_providespackage = /\\\\Provides(?:Package|Class)\\{(.+?)\\}(\\[.*?\\])?/g;',
    )
    .replace(
      "if (!path.endsWith('.sty'))\n            return null;\n\n        const basename = this.basename(path);\n        let tex_package_name = basename.slice(0, basename.length - '.sty'.length);",
      "const tex_extension = path.endsWith('.sty') ? '.sty' : path.endsWith('.cls') ? '.cls' : null;\n        if (!tex_extension)\n            return null;\n\n        const basename = this.basename(path);\n        let tex_package_name = basename.slice(0, basename.length - tex_extension.length);",
    )
    .replace(
      "const tex_packages = files.filter(f => typeof (f.contents) == 'string' && f.path == main_tex_path).map(f => f.contents.split('\\n').filter(l => l.trim().startsWith('\\\\usepackage')).map(l => Array.from(l.matchAll(this.regex_usepackage)).filter(groups => groups.length >= 2).map(groups => groups.pop().split(',')))).flat().flat().flat();",
      "const main_tex_contents = files.filter(f => typeof (f.contents) == 'string' && f.path == main_tex_path).map(f => f.contents).join('\\n');\n        const tex_packages = [\n            ...main_tex_contents.split('\\n').filter(l => l.trim().startsWith('\\\\documentclass')).map(l => Array.from(l.matchAll(this.regex_documentclass)).filter(groups => groups.length >= 2).map(groups => groups.pop().split(','))).flat().flat().flat(),\n            ...main_tex_contents.split('\\n').filter(l => l.trim().startsWith('\\\\usepackage')).map(l => Array.from(l.matchAll(this.regex_usepackage)).filter(groups => groups.length >= 2).map(groups => groups.pop().split(','))).flat().flat().flat(),\n        ].map(tex_package => tex_package.trim().toLowerCase()).filter(tex_package => tex_package.length > 0);",
    )
    .replace(
      "const tex_packages_local = new Set(files.filter(f => this.texmf_local_texmfdist_tex.some(t => f.path.startsWith(t)) || f.path.endsWith('.sty')).map(f => this.extract_tex_package_name(f.path, typeof (f.contents) == 'string' ? f.contents : '')).filter(f => f));",
      "const tex_packages_local = new Set(files.filter(f => this.texmf_local_texmfdist_tex.some(t => f.path.startsWith(t)) || f.path.endsWith('.sty') || f.path.endsWith('.cls')).map(f => this.extract_tex_package_name(f.path, typeof (f.contents) == 'string' ? f.contents : '')).filter(f => f).map(f => f.toLowerCase()));",
    )
    .replaceAll("'--interaction=batchmode', '--halt-on-error'", "'--interaction=nonstopmode'")
    .replaceAll("'--interaction=nonstopmode', '--halt-on-error'", "'--interaction=nonstopmode'")
    .replace(
      'this.max_tex_passes = 3;',
      'this.max_tex_passes = 2;',
    )
    .replace(
      "TEXLIVE_REMOTE_ENDPOINT: ''",
      "TEXLIVE_REMOTE_ENDPOINT: '',\n            PATH: '/bin:/'",
    )
    .replace(
      'const initialized_module = await moduleFactory(Module);\n\n        if (!(this.mem_header_size % 4 == 0 && initialized_module.HEAP32.slice(this.mem_header_size / 4).every(x => x == 0)))',
      "const initialized_module = await moduleFactory(Module);\n\n        const required_applet_paths = ['pdflatex', 'pdftex', 'xelatex', 'xetex', 'lualatex', 'luahblatex', 'luatex', 'bibtex8', 'makeindex', 'xdvipdfmx'];\n        if (!initialized_module.FS.analyzePath('/bin').exists)\n            initialized_module.FS.mkdir('/bin');\n        for (const applet of required_applet_paths) {\n            const appletPath = '/bin/' + applet;\n            if (!initialized_module.FS.analyzePath(appletPath).exists)\n                initialized_module.FS.writeFile(appletPath, new Uint8Array([0]));\n        }\n\n        if (!(this.mem_header_size % 4 == 0 && initialized_module.HEAP32.slice(this.mem_header_size / 4).every(x => x == 0)))",
    )
    .replace(
      "const applets = initialized_module.callMainWithRedirects().stdout.split('\\n').filter(line => line.length > 0);",
      "const applets = initialized_module.callMainWithRedirects().stdout.split('\\n').filter(line => line.length > 0);\n            const applet_paths = new Set([...applets, 'pdflatex', 'pdftex', 'xelatex', 'xetex', 'lualatex', 'luahblatex', 'luatex', 'bibtex8', 'makeindex', 'xdvipdfmx']);\n            if (!initialized_module.FS.analyzePath('/bin').exists)\n                initialized_module.FS.mkdir('/bin');\n            for (const applet of applet_paths) {\n                const appletPath = '/bin/' + applet;\n                if (!initialized_module.FS.analyzePath(appletPath).exists)\n                    initialized_module.FS.writeFile(appletPath, new Uint8Array([0]));\n            }",
    )
    .replace(
      'const pdf = exit_code == 0 ? this.read_all_bytes(FS, pdf_path) : null;\n        const synctex = exit_code == 0 ? this.read_all_bytes(FS, tex_path.replace(\'.tex\', \'.synctex.gz\')) : null;',
      'const pdf_bytes = this.read_all_bytes(FS, pdf_path);\n        const synctex_bytes = this.read_all_bytes(FS, tex_path.replace(\'.tex\', \'.synctex.gz\'));\n        const pdf = pdf_bytes.length > 0 ? pdf_bytes : null;\n        const synctex = synctex_bytes.length > 0 ? synctex_bytes : null;',
    )
}

function patchBusytexEngineSource(source: string): string {
  return source
    .replace(
      'args.unshift(thisProgram);',
      "var appletProgram = args.length > 0 && typeof args[0] == 'string' && args[0].charAt(0) != '-' ? args[0] : null;\n  args.unshift(appletProgram ? '/bin/' + appletProgram : thisProgram);",
    )
    .replace(
      'kpse_remote_fetch_js: _kpse_remote_fetch_js,',
      "kpse_remote_fetch_js: (typeof _kpse_remote_fetch_js === 'function' ? _kpse_remote_fetch_js : function() { return 0; }),",
    )
}


export async function compileLatexWasmToPdf(source: string, options: CompileLatexOptions = {}): Promise<LatexCompileResult> {
  const basePath = await resolveAvailableBusytexBasePath(options.busytexBasePath)
  const remoteEndpoint = resolveBusytexRemoteEndpoint(options.remoteEndpoint)
  const normalizedEntryPath = (options.entryPath?.trim() || 'main.tex').replace(/^\/+/, '')
  const additionalFiles = (options.additionalFiles ?? []).filter((file) => file.path !== 'main.tex')
  const input = normalizedEntryPath === 'main.tex'
    ? source
    : `\\input{${normalizedEntryPath.replace(/\\/g, '/')}}\n`

  try {
    const runner = await getRunner(basePath)
    const compiler = options.engine === 'pdflatex'
      ? new PdfLatex(runner)
      : options.engine === 'lualatex'
        ? new LuaLatex(runner)
        : new XeLatex(runner)

    const compileArgs = {
      input,
      bibtex: options.bibtex ?? shouldRunBibtex(source),
      rerun: options.rerun ?? true,
      additionalFiles,
      verbose: 'silent' as const,
    }

    const result = await compiler.compile({ ...compileArgs, remoteEndpoint })

    if (!result.pdf || result.pdf.length === 0) {
      const error = new Error(result.log?.trim() || 'LaTeX compilation failed.') as Error & { log?: string }
      error.log = result.log?.trim() || undefined
      throw error
    }

    return {
      pdf: result.pdf,
      log: result.log?.trim() || null,
    }
  } catch (error: any) {
    const message = typeof error?.message === 'string' ? error.message : String(error)
    const lowered = message.toLowerCase()
    const missingAssets = !(await busytexAssetExists(basePath))
    const looksLikeAssetIssue = missingAssets && (lowered.includes('busytex') || lowered.includes('failed to fetch') || lowered.includes('404'))

    if (looksLikeAssetIssue) {
      throw new Error(
        `LaTeX WASM assets are missing. Run: "cd frontend && npx texlyre-busytex download-assets ./public/core", then retry.`,
      )
    }

    throw error
  }
}

function shouldRunBibtex(source: string): boolean {
  const probe = source.toLowerCase()
  return probe.includes('\\bibliography{')
    || probe.includes('\\addbibresource{')
    || probe.includes('\\printbibliography')
    || probe.includes('\\cite{')
}
