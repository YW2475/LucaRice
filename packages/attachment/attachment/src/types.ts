/** Durable attachment vocabulary. @module @deepseek-ai/dsh-attachment/types */

import type { AttachmentId, AttachmentOwnerId } from './brand.ts'

export type { AttachmentId, AttachmentOwnerId } from './brand.ts'

/** Raster image formats accepted by the version-one attachment path. */
export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Durable, serializable metadata for one immutable image object. */
export interface ImageAttachmentRef {
  /** Opaque storage identifier; never a filesystem path or bearer URL. */
  attachmentId: AttachmentId
  /** Media type verified from the stored bytes. */
  mediaType: ImageMediaType
  /** Exact encoded byte length. */
  bytes: number
  /** Intrinsic encoded width in pixels. */
  width: number
  /** Intrinsic encoded height in pixels. */
  height: number
  /** Optional display name stripped of local path information. */
  name?: string
}

/** Deployment-resolved limits used by upload admission and request buffering. */
export interface ImageAttachmentLimits {
  maxImageBytes: number
  maxImagesPerMessage: number
  maxMessageImageBytes: number
  maxImagePixels: number
  mediaTypes: readonly ImageMediaType[]
}

/** Request to validate and durably commit one image. */
export interface SaveImageAttachment {
  data: Uint8Array
  /** Caller-declared media type, checked against fully decoded bytes. */
  mediaType: ImageMediaType
  /** Optional browser/provider display name; it is never interpreted as a path. */
  name?: string
}

/** Stored image bytes returned after reference and digest verification. */
export interface StoredImageAttachment {
  ref: ImageAttachmentRef
  data: Uint8Array
}

/** Durable, serializable metadata for one converted document. */
export interface DocumentAttachmentRef {
  /** Opaque identifier used by document tools. */
  attachmentId: AttachmentId
  /** Original display name stripped of local path information. */
  name: string
  /** Exact original byte length. */
  bytes: number
  /** UTF-8 byte length of the converted Markdown. */
  markdownBytes: number
}

/** Request to convert and save one session-owned document. */
export interface SaveDocumentAttachment {
  ownerId: AttachmentOwnerId
  data: Uint8Array
  name: string
}

/** Stored document Markdown returned to an authorized session tool. */
export interface StoredDocumentAttachment {
  attachmentId: AttachmentId
  markdown: string
}
