/** Attachment identifier brand. @module @deepseek-ai/dsh-attachment/brand */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque content-addressed identifier for one immutable attachment object. */
export type AttachmentId = Branded<'AttachmentId'>

/** Opaque owner of one session-scoped attachment directory. */
export type AttachmentOwnerId = Branded<'AttachmentOwnerId'>

/**
 * Brand a validated storage identifier.
 * @param value - backend-produced opaque identifier.
 * @returns the branded identifier.
 */
export function AttachmentId(value: string): AttachmentId {
  return value as AttachmentId
}

/**
 * Brand an attachment owner supplied by an authenticated session operation.
 * @param value - session identity used only as a storage namespace.
 * @returns the branded owner identifier.
 */
export function AttachmentOwnerId(value: string): AttachmentOwnerId {
  return value as AttachmentOwnerId
}
