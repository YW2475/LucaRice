import { Context } from '@deepseek-ai/cordis'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AttachmentOwnerId } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore, {
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_IMAGE_PIXELS,
  DEFAULT_MAX_IMAGES_PER_MESSAGE,
  DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
} from '../src/index.ts'

describe('local attachment service', () => {
  it('resolves every omitted admission limit explicitly', () => {
    const service = new LocalAttachmentStore(new Context(), {})
    expect(DEFAULT_MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024)
    expect(service.imageLimits).toEqual({
      maxImageBytes: DEFAULT_MAX_IMAGE_BYTES,
      maxImagesPerMessage: DEFAULT_MAX_IMAGES_PER_MESSAGE,
      maxMessageImageBytes: DEFAULT_MAX_MESSAGE_IMAGE_BYTES,
      maxImagePixels: DEFAULT_MAX_IMAGE_PIXELS,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    })
  })

  it('saves and reads through the service boundary', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-service-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const data = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ))
      const ref = await service.saveImage({ data, mediaType: 'image/png' })
      await expect(service.readImage(ref)).resolves.toEqual({ ref, data })
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('validates without persisting: a rejected image leaves no storage root behind', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-attachment-validate-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      await expect(service.validateImage({ data: Uint8Array.of(1, 2, 3), mediaType: 'image/png' }))
        .rejects.toThrow(/Unsupported or malformed image data/)
      const valid = Uint8Array.from(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ))
      const limited = new LocalAttachmentStore(new Context(), { dshHome, maxImageBytes: 1 })
      await expect(limited.validateImage({ data: valid, mediaType: 'image/png' }))
        .rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' })
      await expect(service.validateImage({ data: valid, mediaType: 'image/png' })).resolves.toBeUndefined()
      expect(existsSync(service.root)).toBe(false)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })

  it('converts and reads a CSV document below its session directory', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'dsh-document-service-'))
    try {
      const service = new LocalAttachmentStore(new Context(), { dshHome })
      const ownerId = AttachmentOwnerId('session-1')
      const ref = await service.saveDocument({
        ownerId,
        name: '田间记录.csv',
        data: new TextEncoder().encode('日期,水层\n2026-08-20,3cm'),
      })

      const stored = await service.readDocument(ownerId, ref.attachmentId)

      expect(ref.name).toBe('田间记录.csv')
      expect(stored.attachmentId).toBe(ref.attachmentId)
      expect(stored.markdown).toContain('2026-08-20')
      expect(existsSync(join(
        service.root,
        'documents',
        'session-1',
        String(ref.attachmentId),
        'original.csv',
      ))).toBe(true)
    } finally {
      await rm(dshHome, { recursive: true, force: true })
    }
  })
})
