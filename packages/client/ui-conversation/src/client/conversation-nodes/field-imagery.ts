import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'

export interface FieldImageryState {
  readonly turn: number
  readonly images: readonly { attachment: ImageAttachmentRef }[]
}

const definition: ConversationNodeDefinition<FieldImageryState> = {
  kind: 'field-imagery-context',
  match: event => event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === 'field-imagery-context'
    ? { id: String(event.data.id), role: 'start' }
    : null,
  start: (_context, match) => ({
    turn: match.location.kind === 'turn' || match.location.kind === 'step' ? match.location.turn.turn : -1,
    images: match.event.type === 'user/message'
      ? match.event.data.content
        .filter((block): block is Extract<typeof block, { type: 'image' }> => block.type === 'image')
        .map(block => ({ attachment: block.attachment }))
      : [],
  }),
  update: context => context.state,
}

export function registerFieldImageryConversationNode(ctx: Context): void {
  ctx.conversationEvents.register(definition)
}
