/** Durable attachment storage seam (`ctx.attachments`). @module @deepseek-ai/dsh-attachment */

import { Context, Service } from '@deepseek-ai/cordis'
import { AttachmentError } from './error.ts'
import type {
  ImageAttachmentLimits,
  ImageAttachmentRef,
  DocumentAttachmentRef,
  SaveDocumentAttachment,
  StoredDocumentAttachment,
  SaveImageAttachment,
  StoredImageAttachment,
} from './types.ts'

export { AttachmentId, AttachmentOwnerId } from './brand.ts'
export { AttachmentError, isImageAdmissionError } from './error.ts'
export type { AttachmentErrorCode, ImageAdmissionErrorCode } from './error.ts'
export type {
  AttachmentId as AttachmentIdType,
  AttachmentOwnerId as AttachmentOwnerIdType,
  DocumentAttachmentRef,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
  SaveDocumentAttachment,
  StoredDocumentAttachment,
  StoredImageAttachment,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    attachments: AttachmentStore
  }
}

/** Immutable binary attachment service. Implementations validate bytes before publishing a reference. */
export abstract class AttachmentStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'attachments')
  }

  /** Deployment-resolved image policy used by authoritative and fast-path validation. */
  abstract readonly imageLimits: ImageAttachmentLimits

  /**
   * Validate one image without persisting it.
   * Batch callers validate every member before saving any member.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns completion after the encoded raster has been fully decoded.
   */
  abstract validateImage(input: SaveImageAttachment): Promise<void>

  /**
   * Validate one ordered image batch before committing any member.
   * Validation failures start no writes; storage failures return no partial
   * references, although already published content-addressed objects may stay
   * unreachable until a future retention policy collects them.
   * @param inputs - encoded images in their owning message order.
   * @returns durable references in the exact input order.
   */
  async saveImages(inputs: readonly SaveImageAttachment[]): Promise<readonly ImageAttachmentRef[]> {
    const { maxImagesPerMessage, maxMessageImageBytes, mediaTypes } = this.imageLimits
    if (inputs.length > maxImagesPerMessage) {
      throw new AttachmentError('Image batch exceeds the configured image-count limit.', 'TOO_MANY_IMAGES')
    }
    const totalBytes = inputs.reduce((sum, input) => sum + input.data.byteLength, 0)
    if (totalBytes > maxMessageImageBytes) {
      throw new AttachmentError('Image batch exceeds the configured aggregate image-byte limit.', 'IMAGES_TOO_LARGE')
    }
    for (const input of inputs) {
      if (!mediaTypes.includes(input.mediaType)) {
        throw new AttachmentError(`Image type ${input.mediaType} is not accepted by this deployment.`, 'UNSUPPORTED_IMAGE_TYPE')
      }
    }
    for (const input of inputs) await this.validateImage(input)

    const refs: ImageAttachmentRef[] = []
    for (const input of inputs) refs.push(await this.saveImage(input))
    return refs
  }

  /**
   * Validate and durably commit one image before its owning session event is appended.
   * @param input - encoded bytes, declared media type, and optional display name.
   * @returns a durable content-addressed reference.
   */
  abstract saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef>

  /**
   * Read one image and verify that bytes still match the recorded reference.
   * @param ref - durable reference from the session log.
   * @param signal - optional cancellation for backend read and verification work.
   * @returns the verified bytes and canonical reference.
   * @throws the signal reason when aborted, or a storage error when verification fails.
   */
  abstract readImage(ref: ImageAttachmentRef, signal?: AbortSignal): Promise<StoredImageAttachment>

  /**
   * Convert and save one document below its session-owned directory.
   * @param input - owner, original bytes, and display name.
   * @param signal - optional cancellation for external document conversion.
   * @returns a durable reference after both original and Markdown are written.
   */
  saveDocument(_input: SaveDocumentAttachment, _signal?: AbortSignal): Promise<DocumentAttachmentRef> {
    throw new Error('This attachment store does not support documents.')
  }

  /**
   * Read converted Markdown from one session-owned document.
   * @param ownerId - session storage namespace.
   * @param attachmentId - opaque document identifier from the prompt manifest.
   * @param signal - optional cancellation for the filesystem read.
   * @returns the document identity and converted Markdown.
   */
  readDocument(
    _ownerId: SaveDocumentAttachment['ownerId'],
    _attachmentId: DocumentAttachmentRef['attachmentId'],
    _signal?: AbortSignal,
  ): Promise<StoredDocumentAttachment> {
    throw new Error('This attachment store does not support documents.')
  }
}

export default AttachmentStore
