import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const projectRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
process.env.DSH_HOME ??= join(projectRoot, '.lucarice-data')

await import('./bin.ts')
