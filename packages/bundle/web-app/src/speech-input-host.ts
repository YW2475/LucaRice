/** Starts the local speech-to-text service with the Web host. @module speech-input-host */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection/src/account-context.ts'

export const name = 'speech-input-host'
export const inject = ['subprocess', 'webServer', 'accounts']

export interface Config {
  python: string
  server: string
  port: number
  modelDir: string
  ffmpeg: string
  readyFile: string
  cwd: string
}

/** Start sherpa-onnx once and stop it with the Web host. */
export function apply(ctx: Context, config: Config): void {
  const handle = ctx.subprocess.spawn({
    argv: [
      config.python,
      config.server,
      '--port', String(config.port),
      '--model-dir', config.modelDir,
      '--ffmpeg', config.ffmpeg,
      '--ready-file', config.readyFile,
    ],
    cwd: config.cwd,
    stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
    graceMs: 3000,
  })
  ctx.effect(() => () => {
    handle.terminate()
    return handle.waitForExit()
  }, 'speech-input-host.process()')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/_lucarice/speech/transcribe',
    handler: async (request, response) => {
      if (ctx.accounts.userForRequest(request) === undefined) { response.writeHead(401); response.end(); return }
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      const upstream = await fetch(`http://127.0.0.1:${config.port}/_lucarice/speech/transcribe`, {
        method: request.method ?? 'POST',
        headers: { 'content-type': request.headers['content-type'] ?? 'application/octet-stream' },
        body: Buffer.concat(chunks),
      })
      response.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' })
      response.end(Buffer.from(await upstream.arrayBuffer()))
    },
  }), 'speech-input-host.route()')
}
