// Persistence for PDF Editor projects over the existing generic Storage* (bbolt)
// bindings. Each project is one item in the `pdfprojects` bucket; the original
// PDF bytes are base64-encoded inside the JSON envelope (localStorage is too
// small for multi-MB PDFs, so we use the bbolt-backed store instead).

import { StorageGet, StoragePut, StorageGetAll, StorageDelete } from '@/wailsjs/go/main/App'
import { storageSchema } from '@/lib/storageSchemas'
import type { PdfAnnotation } from './annotationModel'

const BUCKET = storageSchema('pdfprojects').bucket
const VERSION = storageSchema('pdfprojects').currentVersion

export interface StoredPdfProject {
  id: string
  name: string
  pageCount: number
  annotations: PdfAnnotation[]
  formValues: Record<string, string | boolean>
  updatedAt: number
  pdfBytes: Uint8Array
}

export interface PdfProjectSummary {
  id: string
  name: string
  pageCount: number
  updatedAt: number
}

interface Envelope {
  version: number
  id: string
  name: string
  pageCount: number
  annotations: PdfAnnotation[]
  formValues: Record<string, string | boolean>
  updatedAt: number
  pdfBase64: string
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function saveProject(project: StoredPdfProject): Promise<void> {
  const envelope: Envelope = {
    version: VERSION,
    id: project.id,
    name: project.name,
    pageCount: project.pageCount,
    annotations: project.annotations,
    formValues: project.formValues,
    updatedAt: project.updatedAt,
    pdfBase64: bytesToBase64(project.pdfBytes),
  }
  await StoragePut(BUCKET, project.id, JSON.stringify(envelope))
}

export async function loadProject(id: string): Promise<StoredPdfProject | null> {
  const raw = await StorageGet(BUCKET, id)
  if (!raw) return null
  return parseEnvelope(raw)
}

export async function deleteProject(id: string): Promise<void> {
  await StorageDelete(BUCKET, id)
}

export async function listProjects(): Promise<PdfProjectSummary[]> {
  let entries: Array<{ key?: string; value?: string }> = []
  try {
    entries = (await StorageGetAll(BUCKET)) as Array<{ key?: string; value?: string }>
  } catch {
    return []
  }
  const summaries: PdfProjectSummary[] = []
  for (const entry of entries) {
    if (!entry.value) continue
    try {
      const env = JSON.parse(entry.value) as Envelope
      summaries.push({ id: env.id, name: env.name, pageCount: env.pageCount, updatedAt: env.updatedAt })
    } catch {
      // Skip corrupt entries.
    }
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

function parseEnvelope(raw: string): StoredPdfProject | null {
  try {
    const env = JSON.parse(raw) as Envelope
    return {
      id: env.id,
      name: env.name,
      pageCount: env.pageCount,
      annotations: Array.isArray(env.annotations) ? env.annotations : [],
      formValues: env.formValues ?? {},
      updatedAt: env.updatedAt,
      pdfBytes: base64ToBytes(env.pdfBase64),
    }
  } catch {
    return null
  }
}
