/** Starts the local deterministic-tools service with the Web host. @module deterministic-tools-host */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'deterministic-tools-host'

/** The host-owned process capability. */
export const inject = ['subprocess', 'webServer', 'accounts']

/** Local deterministic-tools deployment paths. */
export interface Config {
  python: string
  server: string
  port: number
  readyFile: string
  varietyData: string
  dataRoot: string
  cwd: string
}

/** Start the service once for the Web host and stop it with that host. */
export function apply(ctx: Context, config: Config): void {
  const handle = ctx.subprocess.spawn({
    argv: [config.python, config.server, '--port', String(config.port), '--ready-file', config.readyFile, '--variety-data', config.varietyData, '--data-root', config.dataRoot],
    cwd: config.cwd,
    stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
    graceMs: 3000,
  })
  ctx.effect(() => () => {
    handle.terminate()
    return handle.waitForExit()
  }, 'deterministic-tools-host.process()')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: '/_lucarice/exports',
    handler: async (request, response) => {
      const user = ctx.accounts.userForRequest(request)
      if (user === undefined) { response.writeHead(401); response.end(); return }
      const pathname = new URL(request.url ?? '', 'http://lucarice.local').pathname
      const filename = pathname.slice('/_lucarice/exports/'.length).split('/').pop() ?? ''
      const upstream = await fetch(`http://127.0.0.1:${config.port}/exports/${encodeURIComponent(filename)}`, {
        headers: { 'x-lucarice-user-id': user.id },
      })
      response.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
        ...(upstream.headers.get('content-disposition') === null ? {} : { 'content-disposition': upstream.headers.get('content-disposition')! }),
      })
      response.end(Buffer.from(await upstream.arrayBuffer()))
    },
  }), 'deterministic-tools-host.exports-route()')
}
