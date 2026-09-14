/**
 * Model-facing rice-production tools over the local Rice Pi retriever.
 * @module rice-chat/rice-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { existsSync } from 'node:fs'
import { setTimeout } from 'node:timers/promises'

export const name = 'rice-tools'
export const inject = ['tools', 'credentials']

interface Config {
  endpoint: string
  readyFile: string
  domains: readonly Domain[]
}

interface Domain {
  id: string
  tool: string
  description: string
}

const output = {
  schema: {
    type: 'object' as const,
    additionalProperties: true,
    properties: {},
  },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function register(ctx: Context, config: Config, name: string, description: string, path: string, parameters: ParameterSchemaSpec, domain?: string): void {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters,
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const response = await fetch(`${config.endpoint}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(domain === undefined ? args : { ...args, domain }),
        signal: exec.signal,
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
    presentCall: args => ({ card: 'generic', title: name, kind: 'search', rawInput: args }),
  }))
}

/** Registers the five tools named by the rice-production persona. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  while (!existsSync(config.readyFile)) await setTimeout(100)
  register(ctx, config, 'validate_pesticide_safety', 'Check pesticide names against the local banned registry.', '/validate-pesticides', {
    pesticide_names: {
      type: 'array',
      required: true,
      items: { type: 'string' },
      description: 'Proposed pesticide active ingredients or product names.',
    },
  })
  register(ctx, config, 'lookup_rice_variety', 'Search local rice approval data across all variety fields. Returns a preview and a download URL for every matched record.', '/lookup-variety', {
    query: { type: 'string', required: true, description: 'Keyword such as a variety name, breeder, approval number, parent, trait, or growing region.' },
  })
  for (const domain of config.domains) {
    register(ctx, config, domain.tool, domain.description, '/search', {
      query: { type: 'string', required: true, description: 'Focused Chinese retrieval query.' },
    }, domain.id)
  }
  ctx.tools.register(defineTool({
    name: 'search_web',
    description: 'Search current public information with Tavily.',
    parameters: {
      query: { type: 'string', required: true, description: 'Focused Chinese query for current public information.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const credential = await ctx.credentials.resolve(credentialRef('TAVILY_API_KEY'))
      if (credential === undefined) throw new Error('TAVILY_API_KEY is not configured')
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${credential.value}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          query: args.query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: exec.signal,
      })
      if (!response.ok) throw new Error(await response.text())
      return response.json()
    },
    presentCall: args => ({ card: 'generic', title: 'search_web', kind: 'search', rawInput: args }),
  }))
}
