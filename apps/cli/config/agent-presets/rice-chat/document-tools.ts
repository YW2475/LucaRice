/** Read converted documents attached to the current conversation. @module rice-chat/document-tools */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentId, AttachmentOwnerId } from '@deepseek-ai/dsh-attachment'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'document-tools'
export const inject = ['tools', 'attachments']

const MAX_LINES = 500

const output = {
  schema: { type: 'object' as const, additionalProperties: true, properties: {} },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
}

/** Registers the session-scoped document reader. */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'document_read',
    description: 'Read or search Markdown converted from a document attached to this conversation. Use the attachment_id shown in the user message. Do not use this tool for images or agricultural knowledge retrieval.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['read', 'search'], description: 'read returns consecutive lines; search returns lines containing query.' },
      attachment_id: { type: 'string', required: true, description: 'Opaque attachment_id from the conversation attachment manifest.' },
      query: { type: 'string', description: 'Required only for search.' },
      start_line: { type: 'integer', description: 'First 1-based line for read. Defaults to 1.' },
      max_lines: { type: 'integer', description: 'Maximum returned lines, from 1 through 500. Defaults to 200.' },
    },
    output,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('document_read requires a conversation session.')
      const maxLines = args.max_lines ?? 200
      if (maxLines < 1 || maxLines > MAX_LINES) throw new Error('max_lines must be between 1 and 500.')
      const stored = await ctx.attachments.readDocument(
        AttachmentOwnerId(String(exec.agent.id)),
        AttachmentId(args.attachment_id),
        exec.signal,
      )
      const lines = stored.markdown.split(/\r?\n/)
      if (args.operation === 'search') {
        if (args.query === undefined || args.query === '') throw new Error('query is required for search.')
        const query = args.query.toLocaleLowerCase()
        const matches: Array<{ line: number; text: string }> = []
        for (let index = 0; index < lines.length && matches.length < maxLines; index++) {
          const line = lines[index] ?? ''
          if (line.toLocaleLowerCase().includes(query)) matches.push({ line: index + 1, text: line })
        }
        return {
          attachment_id: args.attachment_id,
          operation: 'search',
          total_lines: lines.length,
          returned_lines: matches.length,
          matches,
        }
      }
      const startLine = args.start_line ?? 1
      if (startLine < 1) throw new Error('start_line must be at least 1.')
      const selected = lines.slice(startLine - 1, startLine - 1 + maxLines)
      return {
        attachment_id: args.attachment_id,
        operation: 'read',
        total_lines: lines.length,
        start_line: startLine,
        end_line: startLine + selected.length - 1,
        content: selected.map((line, index) => `${startLine + index}: ${line}`).join('\n'),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'document_read', kind: 'search', rawInput: args }),
  }))
}
