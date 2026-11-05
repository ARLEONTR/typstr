// Fetches typst's own fonts (typst-assets) into public/assets/typst-fonts, so
// the browser compiler loads them from typstr instead of a CDN. The version
// and file names come from src/typstFontAssets.ts. A failed download only
// warns: the app then falls back to the CDN, as before.
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const source = await readFile(fileURLToPath(new URL('../src/typstFontAssets.ts', import.meta.url)), 'utf8')
const version = source.match(/TYPST_ASSETS_VERSION = '([^']+)'/)?.[1]
const files = [...source.matchAll(/'([A-Za-z0-9-]+\.(?:otf|ttf))'/g)].map((match) => match[1])
if (!version || files.length === 0) {
  console.error('download-typst-fonts: could not read the font list from src/typstFontAssets.ts')
  process.exit(1)
}

const outDir = fileURLToPath(new URL(`../public/assets/typst-fonts/${version}/`, import.meta.url))
const cdnBase = `https://cdn.jsdelivr.net/gh/typst/typst-assets@${version}/files/fonts`
await mkdir(outDir, { recursive: true })

const isFont = (bytes) => {
  if (bytes.length < 12) return false
  const tag = bytes.subarray(0, 4).toString('latin1')
  return tag === 'OTTO' || tag === 'true' || tag === 'ttcf' || bytes.readUInt32BE(0) === 0x00010000
}

let failed = 0
for (const file of files) {
  const target = `${outDir}${file}`
  const existing = await stat(target).catch(() => null)
  if (existing && existing.size > 0 && isFont(await readFile(target))) continue
  try {
    const response = await fetch(`${cdnBase}/${file}`, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!isFont(bytes)) throw new Error('not a font file')
    await writeFile(target, bytes)
  } catch (error) {
    failed += 1
    console.warn(`download-typst-fonts: ${file}: ${error instanceof Error ? error.message : error}`)
  }
}

console.log(`download-typst-fonts: ${files.length - failed}/${files.length} fonts in public/assets/typst-fonts/${version}`)
