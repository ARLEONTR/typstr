import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import demoProjects from '../qa/demo-projects.json' with { type: 'json' }

const outputPath = resolve(process.cwd(), '.local-storage', 'manual-qa', 'demo-projects.json')
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, JSON.stringify(demoProjects, null, 2))
console.log(`Wrote demo project manifest to ${outputPath}`)
