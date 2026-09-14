/** Field profile, farm-event, and sensor tools. @module rice-chat/field-management */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/src/account-context.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'field-management'
export const inject = ['tools', 'accounts']

interface Config { endpoint: string }

const output = {
  schema: { type: 'object' as const, additionalProperties: true, properties: {} },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

function accountHeaders(ctx: Context, sessionId: string | undefined): Record<string, string> {
  const userId = sessionId === undefined ? undefined : ctx.accounts.ownerForSession(sessionId)
  if (userId === undefined) throw new Error('当前会话没有账户归属')
  return { 'content-type': 'application/json', 'x-lucarice-user-id': userId }
}

async function post(ctx: Context, endpoint: string, path: string, payload: unknown, sessionId: string | undefined, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${endpoint}${path}`, {
    method: 'POST', headers: accountHeaders(ctx, sessionId), body: JSON.stringify(payload), signal,
  })
  if (!response.ok) throw new Error((await response.json()).error)
  return response.json()
}

export function apply(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'get_field_management_data',
    description: 'Read registered field facts, recent farm events, selected historical events, or current sensor observations. The system adds the three most recent field images to the following model step when imagery is configured. Use only when the user asks about a named field or the answer needs its actual field facts. If list_projects resolves a natural-language field reference, then call overview with the exact returned project name before answering a field-status question; list_projects alone does not provide imagery. This tool reports facts only and does not make agricultural recommendations.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['list_projects', 'overview', 'events', 'current'], description: 'list_projects lists fields. overview returns profile and recent events. events returns a date range. current returns live sensor readings.' },
      field: { type: 'string', description: 'Required except for list_projects. Use the project name or field name provided by the user.' },
      start_date: { type: 'string', description: 'Optional YYYY-MM-DD start date for events.' },
      end_date: { type: 'string', description: 'Optional YYYY-MM-DD end date for events.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (args.operation === 'list_projects') {
        const response = await fetch(`${config.endpoint}/projects`, { headers: accountHeaders(ctx, exec.agent?.session.id), signal: exec.signal })
        if (!response.ok) throw new Error((await response.json()).error)
        return response.json()
      }
      if (args.operation === 'current') return post(ctx, config.endpoint, '/current', args, exec.agent?.session.id, exec.signal)
      return post(ctx, config.endpoint, '/field-data', args, exec.agent?.session.id, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'get_field_management_data', kind: 'search', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'record_field_event',
    description: 'Record a farm operation, field observation, pest or disease observation, disaster, or harvest that the user explicitly says has already happened. Do not use for a recommendation, a plan, a forecast, or an unconfirmed action.',
    parameters: {
      field: { type: 'string', required: true, description: 'Registered project name or field name.' },
      event_type: { type: 'string', required: true, enum: ['sowing', 'transplanting', 'fertilization', 'pesticide_application', 'irrigation', 'drainage', 'drying_field', 'weeding', 'field_observation', 'pest_observation', 'disease_observation', 'disaster_event', 'harvest', 'other'], description: 'Type of completed event.' },
      event_date: { type: 'string', required: true, description: 'Date the event happened, YYYY-MM-DD.' },
      details: { type: 'json', required: true, description: 'Normalized event record. Never invent keys. Use only this standard: sowing: variety, seed_rate, seed_rate_unit, note; transplanting: variety, seedling_age, density, note; fertilization: product_name, dose, dose_unit, application_method, note; pesticide_application: product_name, target, purpose, dose, dose_unit, application_method, note; irrigation/drainage: water_depth, duration, note; drying_field: duration, field_condition, note; weeding: product_name, dose, dose_unit, note; field_observation: tiller_density, plant_height, leaf_color, water_level, observation, note; pest/disease observation: target, severity, affected_area, observation, note; disaster_event: disaster_type, severity, impact, note; harvest: yield, yield_unit, quality, note; other: note. If a required factual field is unclear and would make the record misleading, ask_user_question before recording.' },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) { return post(ctx, config.endpoint, '/record-event', args, exec.agent?.session.id, exec.signal) },
    presentCall: args => ({ card: 'generic', title: 'record_field_event', kind: 'search', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'update_field_profile',
    description: 'Update a registered field\'s stable agronomic profile when the user explicitly corrects or supplements it. Use for facts such as area, variety, dates, cultivation method, target yield, soil, or irrigation condition; do not use for one-time farm operations.',
    parameters: {
      field: { type: 'string', required: true, description: 'Registered project name or field name.' },
      changes: { type: 'json', required: true, description: 'One or more profile changes: location, latitude, longitude, planting_area, planted_variety, sowing_date, transplant_date, cultivation_method, season_type, target_yield, soil_info, or irrigation_condition.' },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) { return post(ctx, config.endpoint, '/update-profile', args, exec.agent?.session.id, exec.signal) },
    presentCall: args => ({ card: 'generic', title: 'update_field_profile', kind: 'search', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'update_field_event',
    description: 'Replace one existing farm-event record after the user explicitly corrects it. First use get_field_management_data with operation events, then use the zero-based event_index from that returned list. Do not use this to add a new event.',
    parameters: {
      field: { type: 'string', required: true, description: 'Registered project name or field name.' },
      event_index: { type: 'integer', required: true, description: 'Zero-based position in the events list returned immediately before this call.' },
      event_type: { type: 'string', required: true, enum: ['sowing', 'transplanting', 'fertilization', 'pesticide_application', 'irrigation', 'drainage', 'drying_field', 'weeding', 'field_observation', 'pest_observation', 'disease_observation', 'disaster_event', 'harvest', 'other'], description: 'Corrected event type.' },
      event_date: { type: 'string', required: true, description: 'Corrected event date, YYYY-MM-DD.' },
      details: { type: 'json', required: true, description: 'Complete corrected normalized record, using only the same standard keys as record_field_event.' },
    },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) { return post(ctx, config.endpoint, '/update-event', args, exec.agent?.session.id, exec.signal) },
    presentCall: args => ({ card: 'generic', title: 'update_field_event', kind: 'search', rawInput: args }),
  }))
}
