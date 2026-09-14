/**
 * Serialize harness messages into DeepSeek chat completions. User text is joined; assistant text
 * becomes `content`, tool calls become `tool_calls`, and tool results become separate tool messages.
 * Assistant reasoning is replayed as `reasoning_content` only on tool-call turns, as required by
 * thinking-mode passback. Core image blocks are rejected explicitly because this wire route is text-only;
 * unknown declaration-merged block types retain the adapter's documented extension fallback.
 * @module dsh-llm-deepseek/serialize
 */

import { contentHasImage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { WireImageContent, WireMessage, WireRequest, WireTextContent, WireTool, WireUserMessage } from './types.ts'

/** Adapter-level request defaults (from plugin config). */
export interface RequestDefaults {
  thinking?: 'enabled' | 'disabled' | undefined
  reasoningEffort?: 'off' | 'low' | 'high' | 'max' | undefined
}

interface ResolvedThinking {
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'low' | 'high' | 'max'
}

/** Validate the adapter-owned effort before resolving its DeepSeek wire fields. */
function reasoningEffort(effort: NonNullable<GenerateOptions['reasoningEffort']>): 'off' | 'low' | 'high' | 'max' {
  if (effort === 'off' || effort === 'low' || effort === 'high' || effort === 'max') {
    return effort as 'off' | 'low' | 'high' | 'max'
  }
  throw new LlmError(
    `DeepSeek does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/** Resolve one legal thinking/effort pair without exposing `off` as a wire effort. */
function resolveThinking(options: GenerateOptions, defaults: RequestDefaults): ResolvedThinking {
  if (options.purpose === 'session-title') return { thinking: 'disabled' }
  const effort = options.reasoningEffort === undefined
    ? defaults.reasoningEffort
    : reasoningEffort(options.reasoningEffort)
  if (defaults.thinking === 'disabled' && effort !== undefined && effort !== 'off') {
    throw new LlmError(
      `DeepSeek deployment does not support reasoning effort "${effort}"`,
      'UNSUPPORTED_REASONING_EFFORT',
    )
  }
  if (effort === 'off') return { thinking: 'disabled' }
  if (effort === 'low' || effort === 'high' || effort === 'max') {
    return { thinking: 'enabled', reasoningEffort: effort }
  }
  return defaults.thinking === undefined ? {} : { thinking: defaults.thinking }
}

/** Join the text blocks of a message (used for user/tool-result content). */
function flattenText(blocks: ContentBlock[]): string {
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Reject core image content before any text-flattening path can silently erase it. */
function assertTextOnly(blocks: readonly ContentBlock[]): void {
  if (contentHasImage(blocks)) {
    throw new LlmError('The DeepSeek chat-completions adapter does not support image content.', 'UNSUPPORTED_CONTENT')
  }
}

async function serializeUserContent(
  blocks: readonly ContentBlock[],
  attachments: AttachmentStore,
): Promise<WireUserMessage['content']> {
  const content: (WireTextContent | WireImageContent)[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      if (block.text.length > 0) content.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image') {
      const stored = await attachments.readImage(block.attachment)
      content.push({
        type: 'image_url',
        image_url: { url: `data:${stored.ref.mediaType};base64,${Buffer.from(stored.data).toString('base64')}` },
      })
    }
  }
  if (content.some(block => block.type === 'image_url')) return content
  return content
    .filter((block): block is WireTextContent => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/** Serialize one assistant message (text + reasoning + tool calls). */
function serializeAssistant(message: Message): WireMessage {
  const text = flattenText(message.content)
  const reasoning = message.content
    .filter(block => block.type === 'reasoning')
    .map(block => block.text)
    .join('')
  const toolCalls = message.content
    .filter(block => block.type === 'tool-call')
    .map(block => ({
      id: block.id,
      type: 'function' as const,
      function: { name: block.name, arguments: block.arguments },
    }))

  return {
    role: 'assistant',
    // Text-less turns send "" — NEVER null. Pure tool-call turns: the
    // official samples replay message.content verbatim (which is "") and
    // some gateways reject null outright. Reasoning-ONLY turns (the model
    // can answer entirely in the reasoning channel, e.g. a v4-flash
    // greeting): the live API rejects null-content/no-tool_calls assistant
    // messages with a 400 ("content or tool_calls must be set"), and since
    // the message sits durably in the session log, a null here bricks every
    // later turn of that session.
    content: text,
    // Official passback rule (guides/thinking_mode.mdx): reasoning_content
    // must return on tool-call turns; it is ignored on plain turns, so we
    // drop it there to save tokens.
    ...toolCalls.length > 0 && reasoning.length > 0 ? { reasoning_content: reasoning } : {},
    ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
  }
}

/**
 * Serialize the conversation. `tool-result` blocks become standalone
 * `{role: 'tool'}` messages; the harness puts each tool result in its own
 * user-role message, so a mixed user message contributes its text first and
 * its tool results as separate wire messages after.
 * @param messages - the harness conversation, in order.
 * @returns the wire messages; order preserved, each tool result expanded into its own entry.
 */
export function serializeMessages(messages: Message[]): WireMessage[] {
  const wire: WireMessage[] = []
  for (const message of messages) {
    assertTextOnly(message.content)
    if (message.role === 'system') {
      wire.push({ role: 'system', content: flattenText(message.content) })
      continue
    }
    if (message.role === 'assistant') {
      wire.push(serializeAssistant(message))
      continue
    }
    // user role: tool results ride in user messages in the harness
    // vocabulary, but DeepSeek wants them as role:'tool' messages.
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    const text = flattenText(message.content)
    if (text.length > 0 || toolResults.length === 0) {
      wire.push({ role: 'user', content: text })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        // Empty tool output still needs SOME content on the wire.
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/** Serialize a history containing user images by resolving their durable attachment references. */
export async function serializeMessagesWithImages(
  messages: Message[],
  attachments: AttachmentStore,
): Promise<WireMessage[]> {
  const wire: WireMessage[] = []
  for (const message of messages) {
    if (message.role !== 'user') {
      assertTextOnly(message.content)
      wire.push(...serializeMessages([message]))
      continue
    }
    const regular = message.content.filter(block => block.type !== 'tool-result')
    const content = await serializeUserContent(regular, attachments)
    const toolResults = message.content.filter(block => block.type === 'tool-result')
    if ((typeof content === 'string' ? content.length > 0 : content.length > 0) || toolResults.length === 0) {
      wire.push({ role: 'user', content })
    }
    for (const result of toolResults) {
      wire.push({
        role: 'tool',
        tool_call_id: result.toolCallId,
        content: flattenText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * Build the full wire request. Always streaming (`stream: true`, usage
 * reporting on); optional fields are omitted rather than sent as null, so
 * provider defaults apply.
 * @param options - the harness request (model, history, system, tools, sampling).
 * @param defaults - adapter-level thinking defaults; undefined fields put nothing on the wire.
 * @returns the chat-completions request body.
 */
function serializeRequestBody(
  options: GenerateOptions,
  messages: WireMessage[],
  defaults: RequestDefaults = {},
): WireRequest {
  const tools: WireTool[] | undefined = options.tools?.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
  // A short title budget must produce visible text; conversation and
  // compaction calls continue to inherit the adapter's thinking defaults.
  const resolvedThinking = resolveThinking(options, defaults)

  return {
    model: options.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    ...resolvedThinking.thinking !== undefined ? { thinking: { type: resolvedThinking.thinking } } : {},
    ...resolvedThinking.reasoningEffort !== undefined
      ? { reasoning_effort: resolvedThinking.reasoningEffort }
      : {},
    ...tools !== undefined && tools.length > 0 ? { tools } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens },
    ...options.stop !== undefined ? { stop: options.stop } : {},
  }
}

export function serializeRequest(
  options: GenerateOptions,
  defaults: RequestDefaults = {},
): WireRequest {
  const messages: WireMessage[] = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  messages.push(...serializeMessages(options.messages))
  return serializeRequestBody(options, messages, defaults)
}

/** Build a request that includes user images as OpenAI-compatible data URLs. */
export async function serializeRequestWithImages(
  options: GenerateOptions,
  attachments: AttachmentStore,
  defaults: RequestDefaults = {},
): Promise<WireRequest> {
  const messages: WireMessage[] = []
  if (options.system !== undefined) messages.push({ role: 'system', content: options.system })
  messages.push(...await serializeMessagesWithImages(options.messages, attachments))
  return serializeRequestBody(options, messages, defaults)
}
