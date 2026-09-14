/** Model-facing deterministic utility tools. @module rice-chat/deterministic-tools */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/src/account-context.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'deterministic-tools'
export const inject = ['tools', 'llm', 'accounts']

interface Config {
  endpoint: string
}

const output = {
  schema: { type: 'object' as const, additionalProperties: true, properties: {} },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function register(ctx: Context, config: Config, name: string, description: string, path: string, parameters: ParameterSchemaSpec): void {
  ctx.tools.register(defineTool({
    name,
    description,
    parameters,
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const payload = Object.fromEntries(Object.entries(args).map(([key, value]) => [
        key,
        (key === 'data' || key === 'rule' || key === 'columns') && typeof value === 'string' ? JSON.parse(value) : value,
      ]))
      const userId = exec.agent === undefined ? undefined : ctx.accounts.ownerForSession(exec.agent.session.id)
      if (userId === undefined) throw new Error('当前会话没有账户归属')
      const response = await fetch(`${config.endpoint}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-lucarice-user-id': userId },
        body: JSON.stringify(payload),
        signal: exec.signal,
      })
      if (!response.ok) throw new Error((await response.json()).error)
      return response.json()
    },
    presentCall: args => ({ card: 'generic', title: name, kind: 'search', rawInput: args }),
  }))
}

async function post(ctx: Context, endpoint: string, payload: unknown, sessionId: string | undefined, signal: AbortSignal): Promise<unknown> {
  const userId = sessionId === undefined ? undefined : ctx.accounts.ownerForSession(sessionId)
  if (userId === undefined) throw new Error('当前会话没有账户归属')
  const response = await fetch(`${endpoint}/export-table`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-lucarice-user-id': userId },
    body: JSON.stringify(payload),
    signal,
  })
  if (!response.ok) throw new Error((await response.json()).error)
  return response.json()
}

async function fillCells(ctx: Context, exec: ToolRunContext, pending: Array<{
  row: number
  column: { header: string; instruction?: string }
  record: { name: string; fields: Record<string, string> }
}>): Promise<Array<{ row: number; header: string; value: string; evidence: string }>> {
  const fallback = exec.agent?.options.provider === undefined || exec.agent.options.model === undefined
    ? undefined
    : { provider: exec.agent.options.provider, model: exec.agent.options.model }
  const target = exec.agent?.session.requestHeader()?.config ?? fallback
  if (target === undefined) throw new Error('export_table needs a selected model to complete unresolved cells.')
  const assembler = new BlockAssembler()
  const prompt = {
    cells: pending.map(item => ({
      row: item.row,
      header: item.column.header,
      instruction: item.column.instruction ?? item.column.header,
      record: item.record,
    })),
  }
  for await (const chunk of ctx.llm.stream({
    provider: target.provider,
    model: target.model,
    system: 'Fill requested CSV cells from supplied raw records. Return JSON only: {"cells":[{"row":number,"header":string,"value":string,"evidence":string}]}. Extract only directly supported values. evidence must be an exact continuous substring from the supplied record and include value. Return empty value and evidence when unsupported or ambiguous.',
    messages: [createUserMessage({
      content: [{ type: 'text', text: JSON.stringify(prompt) }],
      source: { kind: 'plugin', plugin: name },
    })],
    sessionId: exec.agent?.session.id,
    signal: exec.signal,
  })) assembler.push(chunk)
  const text = assembler.blocks()
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
  return (JSON.parse(text) as { cells: Array<{ row: number; header: string; value: string; evidence: string }> }).cells
}

function registerExportTable(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'export_table',
    description: 'Export every record matched in a registered structured data source as a CSV. Use for complete lists, CSV downloads, or user-specified columns; do not build a complete table from a lookup preview. When direct extraction leaves a cell empty, the currently selected registered model fills it only with evidence from that record.',
    parameters: {
      source: { type: 'string', required: true, description: 'Registered data source. Currently: rice_variety.' },
      query: { type: 'string', required: true, description: 'Keyword used to select every matching record in the source.' },
      columns: { type: 'json', required: true, description: 'JSON array of column definitions. Each column has header and either type:"index" or field:"name" / a source field name. record_text contains every raw field: use field:"record_text" plus pattern when fields vary. pattern extracts regex group 1. Optional instruction states the required selection meaning for model completion. Optional calculation:"group1/group2" divides group 1 by group 2.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const payload = { ...args, columns: JSON.parse(args.columns), mode: 'prepare' }
      const prepared = await post(ctx, config.endpoint, payload, exec.agent?.session.id, exec.signal) as {
        rows: Array<Record<string, string>>
        pending: Array<{ row: number; column: { header: string; instruction?: string }; record: { name: string; fields: Record<string, string> } }>
      }
      const fills = []
      for (let start = 0; start < prepared.pending.length; start += 4) {
        fills.push(...await fillCells(ctx, exec, prepared.pending.slice(start, start + 4)))
      }
      return post(ctx, config.endpoint, { ...payload, mode: 'finalize', fills }, exec.agent?.session.id, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'export_table', kind: 'search', rawInput: args }),
  }))
}

/** Registers computation and date arithmetic tools. */
export function apply(ctx: Context, config: Config): void {
  register(ctx, config, 'compute', 'Perform explicit arithmetic, basic statistics, rice-production unit conversion, or rainfall-volume calculation. Use only when all numbers and units are known; do not use it to choose agricultural recommendations.', '/compute', {
    operation: { type: 'string', required: true, description: 'add, subtract, multiply, divide, percentage, ratio, sum, mean, median, min, max, count, standard_deviation, percentage_above_threshold, percentage_below_threshold, convert, or rainfall_volume.' },
    data: { type: 'json', required: true, description: 'For values operations: {"values":[...], "threshold":... when needed}. For convert: {"value":...,"from_unit":"kg/亩","to_unit":"kg/ha"}. For rainfall_volume: {"rainfall_mm":...,"area_ha":...}.' },
  })
  register(ctx, config, 'date_math', 'Perform explicit date or time arithmetic only. Use for calendar calculations, not for crop growth-stage judgment.', '/date-math', {
    operation: { type: 'string', required: true, description: 'add_days, difference, relation, or overlap.' },
    data: { type: 'json', required: true, description: 'add_days: {"date":"YYYY-MM-DD","days":5}; difference: {"start":"...","end":"...","unit":"hours|days|weeks"}; relation: {"first":"...","second":"..."}; overlap: {"first_start":"...","first_end":"...","second_start":"...","second_end":"..."}.' },
  })
  registerExportTable(ctx, config)
}
