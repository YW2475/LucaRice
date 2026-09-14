/** Session-scoped document conversion and storage. */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { formatFromExtension, toMarkdownBytes } from '@firecrawl/anydoc'
import {
  AttachmentId,
  type DocumentAttachmentRef,
  type SaveDocumentAttachment,
  type StoredDocumentAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'

const MINERU_EXECUTABLE = 'C:/Users/ME/AppData/Local/miniconda3/envs/mineru_gpu/Scripts/mineru.exe'

function cleanName(value: string): string {
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
}

function documentDirectory(root: string, ownerId: string, attachmentId: string): string {
  return join(root, 'documents', encodeURIComponent(ownerId), encodeURIComponent(attachmentId))
}

async function convertPdf(
  subprocess: SubprocessRuntime,
  originalPath: string,
  outputDirectory: string,
  signal?: AbortSignal,
): Promise<string> {
  const handle = subprocess.spawn({
    argv: [
      MINERU_EXECUTABLE,
      '--path', originalPath,
      '--output', outputDirectory,
      '--backend', 'pipeline',
      '--method', 'auto',
    ],
    cwd: outputDirectory,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 16 * 1024 },
      stderr: { maxBytes: 16 * 1024 },
    },
    graceMs: 5_000,
    signal,
  })
  const outcome = await handle.done
  if (outcome.exitCode !== 0) {
    const stderr = handle.collected.stderr?.readFrom(0).text.trim()
    throw new Error(stderr === '' ? `MinerU exited with code ${String(outcome.exitCode)}.` : stderr)
  }
  return readFile(join(outputDirectory, 'original', 'auto', 'original.md'), 'utf8')
}

/**
 * Convert and save one original document and its Markdown representation.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - owner, original bytes, and display name.
 * @param subprocess - mounted execution service used only for MinerU PDF conversion.
 * @param signal - optional cancellation for MinerU.
 * @returns the durable document reference.
 */
export async function saveDocumentFile(
  root: string,
  input: SaveDocumentAttachment,
  subprocess: SubprocessRuntime | undefined,
  signal?: AbortSignal,
): Promise<DocumentAttachmentRef> {
  const name = cleanName(input.name)
  const extension = extname(name).toLowerCase()
  const format = extension === '.md' ? null : formatFromExtension(extension)
  if (name === '' || (extension !== '.md' && format === null)) throw new Error(`Unsupported document type: ${extension || '(none)'}`)

  const id = randomUUID()
  const directory = documentDirectory(root, String(input.ownerId), id)
  const originalPath = join(directory, `original${extension}`)
  const mineruOutput = join(directory, 'mineru-output')
  await mkdir(directory, { recursive: true, mode: 0o700 })
  try {
    await writeFile(originalPath, input.data, { mode: 0o600 })
    let markdown: string
    if (extension === '.pdf') {
      if (subprocess === undefined) throw new Error('MinerU requires the subprocess service.')
      await mkdir(mineruOutput)
      markdown = await convertPdf(subprocess, originalPath, mineruOutput, signal)
    } else if (extension === '.md') {
      markdown = Buffer.from(input.data).toString('utf8')
    } else {
      markdown = await toMarkdownBytes(input.data, format)
    }
    await writeFile(join(directory, 'content.md'), markdown, { encoding: 'utf8', mode: 0o600 })
    if (extension === '.pdf') await rm(mineruOutput, { recursive: true })
    return {
      attachmentId: AttachmentId(id),
      name,
      bytes: input.data.byteLength,
      markdownBytes: Buffer.byteLength(markdown),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}

/**
 * Read converted Markdown below one owner directory.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ownerId - session storage namespace.
 * @param attachmentId - document identifier from its prompt manifest.
 * @param signal - optional cancellation for the filesystem read.
 * @returns the document identity and Markdown.
 */
export async function readDocumentFile(
  root: string,
  ownerId: SaveDocumentAttachment['ownerId'],
  attachmentId: DocumentAttachmentRef['attachmentId'],
  signal?: AbortSignal,
): Promise<StoredDocumentAttachment> {
  const markdown = await readFile(
    join(documentDirectory(root, String(ownerId), String(attachmentId)), 'content.md'),
    { encoding: 'utf8', signal },
  )
  return { attachmentId, markdown }
}
