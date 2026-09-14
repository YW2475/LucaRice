/** Starts the local field-management service with the Web host. @module field-management-host */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection/src/account-context.ts'

export const name = 'field-management-host'
export const inject = ['subprocess', 'webServer', 'accounts']

export interface Config {
  python: string
  server: string
  port: number
  configFile: string
  cosConfigFile: string
  readyFile: string
  cwd: string
}

export function apply(ctx: Context, config: Config): void {
  const handle = ctx.subprocess.spawn({
    argv: [config.python, config.server, '--port', String(config.port), '--config-file', config.configFile, '--cos-config-file', config.cosConfigFile, '--data-root', process.env.LUCARICE_DATA_HOME ?? '', '--ready-file', config.readyFile],
    cwd: config.cwd,
    stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
    graceMs: 3000,
  })
  ctx.effect(() => () => {
    handle.terminate()
    return handle.waitForExit()
  }, 'field-management-host.process()')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/_lucarice/fields',
    handler: async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const user = ctx.accounts.userForRequest(request)
      if (user === undefined) { response.writeHead(401); response.end(); return }
      const upstream = await fetch(`http://127.0.0.1:${config.port}/fields`, {
        method: request.method ?? 'GET',
        headers: { 'content-type': request.headers['content-type'] ?? 'application/json', 'x-lucarice-user-id': user.id },
        ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      })
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      response.end(Buffer.from(await upstream.arrayBuffer()))
    },
  }), 'field-management-host.route()')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/_lucarice/field-data',
    handler: async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const user = ctx.accounts.userForRequest(request)
      if (user === undefined) { response.writeHead(401); response.end(); return }
      const upstream = await fetch(`http://127.0.0.1:${config.port}/field-data`, {
        method: request.method ?? 'GET',
        headers: { 'content-type': request.headers['content-type'] ?? 'application/json', 'x-lucarice-user-id': user.id },
        ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      })
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      response.end(Buffer.from(await upstream.arrayBuffer()))
    },
  }), 'field-management-host.field-data-route()')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/_lucarice/events',
    handler: async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const user = ctx.accounts.userForRequest(request)
      if (user === undefined) { response.writeHead(401); response.end(); return }
      const upstream = await fetch(`http://127.0.0.1:${config.port}/events`, {
        method: request.method ?? 'GET',
        headers: { 'content-type': request.headers['content-type'] ?? 'application/json', 'x-lucarice-user-id': user.id },
        ...(request.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
      })
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      response.end(Buffer.from(await upstream.arrayBuffer()))
    },
  }), 'field-management-host.events-route()')
}
