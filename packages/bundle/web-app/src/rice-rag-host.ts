/** Starts the local rice retriever with the Web host. @module rice-rag-host */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { rmSync } from 'node:fs'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'rice-rag-host'

/** The host-owned process capability. */
export const inject = ['subprocess', 'workspaceRegistry', 'webServer', 'accounts']

/** Paths for the editable local rice retrieval deployment. */
export interface Config {
  python: string
  server: string
  domains: Record<string, string>
  modelDir: string
  rerankerModelDir: string
  varietyData: string
  exportDir: string
  readyFile: string
  cwd: string
}

/** Start the retriever once for the Web host and stop it with that host. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.workspaceRegistry.create(process.cwd(), 'LucaRice')
  rmSync(config.readyFile, { force: true })
  const handle = ctx.subprocess.spawn({
    argv: [
      config.python,
      config.server,
      ...Object.entries(config.domains).flatMap(([domain, packageDir]) => ['--domain', `${domain}=${packageDir}`]),
      '--model-dir', config.modelDir,
      '--reranker-model-dir', config.rerankerModelDir,
      '--variety-data', config.varietyData,
      '--export-dir', config.exportDir,
      '--ready-file', config.readyFile,
    ],
    cwd: config.cwd,
    stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
    graceMs: 3000,
  })
  ctx.effect(() => () => {
    handle.terminate()
    return handle.waitForExit()
  }, 'rice-rag-host.process()')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/_lucarice/rice-variety-exports',
    handler: async (request, response) => {
      if (ctx.accounts.userForRequest(request) === undefined) { response.writeHead(401); response.end(); return }
      const pathname = new URL(request.url ?? '', 'http://lucarice.local').pathname
      const filename = pathname.slice('/_lucarice/rice-variety-exports/'.length).split('/').pop() ?? ''
      const upstream = await fetch(`http://127.0.0.1:8765/exports/${encodeURIComponent(filename)}`)
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
        ...(upstream.headers.get('content-disposition') === null ? {} : { 'content-disposition': upstream.headers.get('content-disposition')! }),
      })
      response.end(Buffer.from(await upstream.arrayBuffer()))
    },
  }), 'rice-rag-host.exports-route()')
}
