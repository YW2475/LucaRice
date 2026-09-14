/** Starts the local field-weather service with the Web host. @module field-weather-host */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'

export const name = 'field-weather-host'
export const inject = ['subprocess']

export interface Config {
  python: string
  server: string
  port: number
  fieldsFile: string
  envFile: string
  readyFile: string
  cwd: string
}

export function apply(ctx: Context, config: Config): void {
  const handle = ctx.subprocess.spawn({
    argv: [config.python, config.server, '--port', String(config.port), '--fields-file', config.fieldsFile, '--data-root', process.env.LUCARICE_DATA_HOME ?? '', '--env-file', config.envFile, '--ready-file', config.readyFile],
    cwd: config.cwd,
    stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
    graceMs: 3000,
  })
  ctx.effect(() => () => {
    handle.terminate()
    return handle.waitForExit()
  }, 'field-weather-host.process()')
}
