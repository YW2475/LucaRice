/** Weather forecasts for configured field projects or explicit locations. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-client-connection/src/account-context.ts'

export const name = 'field-weather'
export const inject = ['tools', 'accounts']

interface Config { endpoint: string }

const output = {
  schema: { type: 'object' as const, additionalProperties: true, properties: {} },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'get_field_weather',
    description: 'Read weather for a registered field or a user-provided natural-language location. The tool resolves Chinese province/city/county names internally. If it returns location.status "ambiguous", use ask_user_question to let the user choose a candidate; if it returns "not_found", ask for a more specific location. Use only when weather facts are necessary for a rice-production answer or preventive measures.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['current', '2h_rain', '72h', '7d', 'alerts'], description: 'Requested weather time scale.' },
      field: { type: 'string', description: 'Registered project or field name. Prefer this when the user mentions a configured field.' },
      location: { type: 'string', description: 'Natural-language location provided by the user, LocationID, or longitude,latitude. Used only when field is absent.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const userId = exec.agent === undefined ? undefined : ctx.accounts.ownerForSession(exec.agent.session.id)
      if (userId === undefined) throw new Error('当前会话没有账户归属')
      const response = await fetch(`${config.endpoint}/forecast`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-lucarice-user-id': userId }, body: JSON.stringify(args), signal: exec.signal,
      })
      if (!response.ok) throw new Error((await response.json()).error)
      return response.json()
    },
    presentCall: args => ({ card: 'generic', title: 'get_field_weather', kind: 'search', rawInput: args }),
  }))
}
