import { gunzipSync } from 'node:zlib'

type TypstPackageSpec = {
  namespace: string
  name: string
  version: string
}

export interface TypstPackageBundle {
  rootPath: string
  files: Array<{ path: string; contentBase64: string }>
}

const PACKAGE_REGISTRY_BASE_URL = process.env.TYPST_PACKAGE_REGISTRY_URL ?? 'https://packages.typst.org'
const packageBundleCache = new Map<string, Promise<TypstPackageBundle>>()

export async function getTypstPackageBundle(spec: TypstPackageSpec): Promise<TypstPackageBundle> {
  const normalized = normalizePackageSpec(spec)
  const cacheKey = `${normalized.namespace}/${normalized.name}@${normalized.version}`
  const existing = packageBundleCache.get(cacheKey)
  if (existing) {
    return existing
  }

  const loading = fetchTypstPackageBundle(normalized).catch((error) => {
    packageBundleCache.delete(cacheKey)
    throw error
  })
  packageBundleCache.set(cacheKey, loading)
  return loading
}

function normalizePackageSpec(spec: TypstPackageSpec): TypstPackageSpec {
  const normalized = {
    namespace: spec.namespace.trim(),
    name: spec.name.trim(),
    version: spec.version.trim(),
  }
  validatePackageSpec(normalized)
  return normalized
}

function validatePackageSpec(spec: TypstPackageSpec): void {
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

async function fetchTypstPackageBundle(spec: TypstPackageSpec): Promise<TypstPackageBundle> {
  if (!spec.namespace || !spec.name || !spec.version) {
    throw new Error('Package namespace, name, and version are required.')
  }

  const packageUrl = `${PACKAGE_REGISTRY_BASE_URL.replace(/\/+$/, '')}/${encodeURIComponent(spec.namespace)}/${encodeURIComponent(spec.name)}-${encodeURIComponent(spec.version)}.tar.gz`
  const response = await fetch(packageUrl)
  if (!response.ok) {
    throw new Error(`Failed to download Typst package ${spec.namespace}/${spec.name}@${spec.version}.`)
  }

  const tarball = new Uint8Array(await response.arrayBuffer())
  const tar = gunzipSync(tarball)
  const files = extractTarEntries(tar).map((entry) => ({
    path: entry.path,
    contentBase64: Buffer.from(entry.content).toString('base64'),
  }))

  const bundle = {
    rootPath: `/typst/packages/${spec.namespace}/${spec.name}-${spec.version}`,
    files,
  }
  validatePackageBundle(bundle)
  return bundle
}

function extractTarEntries(tar: Uint8Array): Array<{ path: string; content: Uint8Array }> {
  const files: Array<{ path: string; content: Uint8Array }> = []
  let offset = 0

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (isZeroBlock(header)) {
      break
    }

    const name = readTarString(header.subarray(0, 100))
    const prefix = readTarString(header.subarray(345, 500))
    const size = parseTarOctal(readTarString(header.subarray(124, 136)))
    const typeFlag = readTarString(header.subarray(156, 157))
    const fullPath = [prefix, name].filter(Boolean).join('/')

    offset += 512
    const fileContent = tar.subarray(offset, offset + size)

    if ((typeFlag === '' || typeFlag === '0') && fullPath) {
      const normalizedPath = fullPath.replace(/^\.\/+/, '').replace(/^\/+/, '')
      if (!normalizedPath || normalizedPath.includes('..')) {
        offset += Math.ceil(size / 512) * 512
        continue
      }
      files.push({
        path: normalizedPath,
        content: new Uint8Array(fileContent),
      })
    }

    offset += Math.ceil(size / 512) * 512
  }

  return files
}

function readTarString(bytes: Uint8Array): string {
  let end = bytes.indexOf(0)
  if (end === -1) {
    end = bytes.length
  }
  return Buffer.from(bytes.subarray(0, end)).toString('utf8').trim()
}

function parseTarOctal(value: string): number {
  const normalized = value.replace(/\0/g, '').trim()
  if (!normalized) {
    return 0
  }
  return Number.parseInt(normalized, 8)
}

function isZeroBlock(block: Uint8Array): boolean {
  for (const byte of block) {
    if (byte !== 0) {
      return false
    }
  }
  return true
}

function validatePackageBundle(bundle: TypstPackageBundle): void {
  if (!bundle.rootPath || !bundle.rootPath.startsWith('/typst/packages/')) {
    throw new Error('Invalid Typst package rootPath.')
  }
  if (!Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error('Typst package bundle is empty.')
  }
  for (const file of bundle.files) {
    if (!file.path || file.path.includes('..') || file.path.startsWith('/')) {
      throw new Error(`Invalid Typst package file path: ${file.path}`)
    }
    if (!file.contentBase64) {
      throw new Error(`Missing Typst package file content: ${file.path}`)
    }
    try {
      Buffer.from(file.contentBase64, 'base64')
    } catch {
      throw new Error(`Invalid base64 content in Typst package file: ${file.path}`)
    }
  }
}
