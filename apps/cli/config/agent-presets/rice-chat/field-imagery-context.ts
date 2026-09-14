/** Add images after a field-management read, where vision models can receive them. */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection/src/account-context.ts'

export const name = 'field-imagery-context'
export const inject = ['agents', 'attachments', 'accounts', 'settings']

const LOCALE_NAMESPACE = settingsNamespace('locale')

type ToolCallEvent = { type: 'tool/call'; data: { turn: number; name: string; arguments: string } }

function fieldReadInTurn(agent: { session: { events: readonly { type: string; data: unknown }[] } }, turn: number): string | undefined {
  // A model may resolve a natural-language field alias with list_projects in
  // the same turn as an overview/current read. Walk backward until the most
  // recent concrete read, rather than letting a trailing list call suppress
  // imagery for that concrete field.
  for (let index = agent.session.events.length - 1; index >= 0; index -= 1) {
    const item = agent.session.events[index]
    if (item?.type !== 'tool/call') continue
    const event = item as ToolCallEvent
    if (event.data.turn !== turn || event.data.name !== 'get_field_management_data') continue
    const args = JSON.parse(event.data.arguments) as { operation?: string; field?: string }
    if (args.operation !== 'list_projects' && args.field !== undefined) return args.field
  }
  return undefined
}

function imageInstruction(locale: unknown, field: string, dates: string): string {
  if (locale === 'en') return `The latest representative images for field “${field}” are provided for ${dates}. Inspect the images directly and use only visible observations as evidence.`
  if (locale === 'fr') return `Les images représentatives les plus récentes de la parcelle « ${field} » sont fournies pour les dates suivantes : ${dates}. Examinez directement les images et n’utilisez comme preuves que les observations visibles.`
  return `田块“${field}”最近三天的代表影像已提供，日期为：${dates}。请直接查看图片；只将图中可直接观察到的现象作为证据。`
}

export function apply(ctx: Context): void {
  const injectedTurns = new WeakMap<object, Set<number>>()
  ctx.on('agent/pre-step', async ({ agent, turn, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const agentTurns = injectedTurns.get(agent) ?? new Set<number>()
    if (agentTurns.has(turn)) return decision
    const field = fieldReadInTurn(agent, turn)
    if (field === undefined) return decision
    const userId = ctx.accounts.ownerForSession(agent.session.id)
    if (userId === undefined) throw new Error('当前会话没有账户归属')
    const response = await fetch('http://127.0.0.1:8768/field-images', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lucarice-user-id': userId },
      body: JSON.stringify({ field }),
      signal,
    })
    if (!response.ok) throw new Error((await response.json() as { error: string }).error)
    const value = await response.json() as { images: Array<{ date: string; name: string; url: string; media_type: 'image/jpeg' }> }
    if (value.images.length === 0) return decision
    const attachments = await ctx.attachments.saveImages(await Promise.all(value.images.map(async image => ({
      data: new Uint8Array(await fetch(image.url, { signal }).then(response => response.arrayBuffer())),
      mediaType: image.media_type,
      name: `${image.date}-${image.name}`,
    }))))
    const preference = (ctx.settings.get(LOCALE_NAMESPACE) as { preference?: unknown } | undefined)?.preference
    const text = imageInstruction(preference, field, value.images.map(image => image.date).join('、'))
    agentTurns.add(turn)
    injectedTurns.set(agent, agentTurns)
    return {
      kind: 'enter',
      messages: [...decision.messages, createUserMessage({
        content: [{ type: 'text', text }, ...attachments.map(attachment => ({ type: 'image' as const, attachment }))],
        source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name, text }] },
      })],
    }
  }, { prepend: true })
}
