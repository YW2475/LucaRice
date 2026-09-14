import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const DIST_ROOT = fileURLToPath(new URL('../dist', import.meta.url))

it('ships install metadata with the built web application', async () => {
  const index = await readFile(join(DIST_ROOT, 'index.html'), 'utf8')
  expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />')

  const manifest: unknown = JSON.parse(await readFile(join(DIST_ROOT, 'manifest.webmanifest'), 'utf8'))
  expect(manifest).toEqual({
    id: '/',
    name: 'LucaRice',
    short_name: 'LucaRice',
    start_url: '/',
    scope: '/',
    display: 'fullscreen',
    icons: [{
      src: '/lucarice-logo.png',
      sizes: '1280x1280',
      type: 'image/png',
      purpose: 'any',
    }],
  })
})

it('ships the LucaRice logo used by the manifest and browser icon', async () => {
  const logo = await readFile(join(DIST_ROOT, 'lucarice-logo.png'))
  expect(logo.byteLength).toBeGreaterThan(0)
})
