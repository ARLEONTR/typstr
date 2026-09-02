import { createHash } from 'node:crypto'
import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transform } from 'esbuild'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
const assetsDir = join(distDir, 'assets')
const textFilePattern = /\.(?:html|css|m?js|json|map)$/

const listFiles = async (dir) => {
  const entries = await readdir(dir)
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry)
      return (await stat(path)).isDirectory() ? listFiles(path) : path
    }),
  )

  return files.flat()
}

const contentHash = (source) =>
  createHash('sha256').update(source).digest('base64url').slice(0, 8)

const hashedAssetName = (fileName, source) => {
  const hash = contentHash(source)
  return fileName.replace(/(\.m?js)$/u, `-${hash}$1`)
}

const assets = await readdir(assetsDir)
const javascriptAssets = assets.filter((file) => /\.m?js$/u.test(file))
const replacements = new Map()
let rewritten = 0

for (const file of javascriptAssets) {
  const path = join(assetsDir, file)
  const source = await readFile(path, 'utf8')
  const result = await transform(source, {
    format: 'esm',
    target: 'es2020',
    supported: {
      'nullish-coalescing': false,
      'optional-chain': false,
      'top-level-await': true,
    },
  })

  if (result.code === source) {
    continue
  }

  rewritten += 1
  const nextFile = hashedAssetName(file, result.code)
  await writeFile(path, result.code)

  if (nextFile !== file) {
    await rename(path, join(dirname(path), nextFile))
    replacements.set(file, nextFile)
  }
}

if (replacements.size > 0) {
  const distFiles = (await listFiles(distDir)).filter((file) => textFilePattern.test(file))

  await Promise.all(
    distFiles.map(async (file) => {
      let source = await readFile(file, 'utf8')
      const original = source

      for (const [from, to] of replacements) {
        source = source.split(from).join(to)
      }

      if (source !== original) {
        await writeFile(file, source)
      }
    }),
  )
}

console.log(`Safari compatibility pass rewrote ${rewritten} JavaScript assets.`)
