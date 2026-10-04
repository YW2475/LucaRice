/** Adds the current China time from the configured public API once per turn. @module rice-time-context */

import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** Cordis plugin name used by the durable injected message. */
export const name = 'rice-time-context'

/** The agent registry supplies request preparation. */
export const inject = ['agents']

/** Public time API and zone used on the first step of each turn. */
export interface Config {
  endpoint: string
  timeZone: string
}

/** Read one external time value at the start of each turn. */
export function apply(ctx: Context, config: Config): void {
  ctx.on('agent/pre-step', async ({ step, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
    let value: { dateTime: string }
    try {
      const response = await fetch(`${config.endpoint}?timeZone=${encodeURIComponent(config.timeZone)}`, { signal })
      if (!response.ok) return decision
      value = await response.json() as { dateTime: string }
    } catch {
      return decision
    }
    const text = `当前时间由时间 API 提供：${value.dateTime}（${config.timeZone}）。将未注明时区的日期和时间按此时区理解。`
    return {
      kind: 'enter',
      messages: [
        ...decision.messages,
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
        }),
      ],
    }
  }, { prepend: true })
}
