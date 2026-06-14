// Persistence for PDF Editor projects over the existing generic Storage* (bbolt)
// bindings. New projects are split into lightweight metadata plus the original
// PDF bytes under separate keys, so listing projects never reads multi-MB PDFs.

import { StorageGet, StoragePut, StorageGetAll, StorageDelete, StorageList } from '@/wailsjs/go/main/App'
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

interface ProjectMeta {
  version: number
  id: string
  name: string
  pageCount: number
  annotations: PdfAnnotation[]
  formValues: Record<string, string | boolean>
  updatedAt: number
}

interface Envelope extends ProjectMeta {
  pdfBase64: string
}

const metaKey = (id: string) => `meta:${id}`
const bytesKey = (id: string) => `bytes:${id}`

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
  const meta: ProjectMeta = {
    version: VERSION,
    id: project.id,
    name: project.name,
    pageCount: project.pageCount,
    annotations: project.annotations,
    formValues: project.formValues,
    updatedAt: project.updatedAt,
  }
  await StoragePut(BUCKET, bytesKey(project.id), bytesToBase64(project.pdfBytes))
  await StoragePut(BUCKET, metaKey(project.id), JSON.stringify(meta))
  await StorageDelete(BUCKET, project.id).catch(() => {})
}

export async function loadProject(id: string): Promise<StoredPdfProject | null> {
  const metaRaw = await StorageGet(BUCKET, metaKey(id)).catch(() => '')
  if (metaRaw) {
    const bytesRaw = await StorageGet(BUCKET, bytesKey(id)).catch(() => '')
    if (!bytesRaw) return null
    return parseMeta(metaRaw, bytesRaw)
  }
  const legacyRaw = await StorageGet(BUCKET, id).catch(() => '')
  return legacyRaw ? parseEnvelope(legacyRaw) : null
}

export async function deleteProject(id: string): Promise<void> {
  await StorageDelete(BUCKET, metaKey(id)).catch(() => {})
  await StorageDelete(BUCKET, bytesKey(id)).catch(() => {})
  await StorageDelete(BUCKET, id).catch(() => {})
}

export async function listProjects(): Promise<PdfProjectSummary[]> {
  let entries: Array<{ key?: string; value?: string }> = []
  try {
    const keys = await StorageList(BUCKET, 'meta:')
    entries = await Promise.all(keys.map(async (key) => ({ key, value: await StorageGet(BUCKET, key).catch(() => '') })))
  } catch {
    entries = []
  }
  if (entries.length === 0) {
    try {
      entries = (await StorageGetAll(BUCKET)) as Array<{ key?: string; value?: string }>
    } catch {
      return []
    }
  }
  const summaries: PdfProjectSummary[] = []
  for (const entry of entries) {
    if (!entry.value) continue
    try {
      const env = JSON.parse(entry.value) as ProjectMeta
      if (!env.id || !env.name) continue
      summaries.push({ id: env.id, name: env.name, pageCount: env.pageCount, updatedAt: env.updatedAt })
    } catch {
      // Skip corrupt entries.
    }
  }
  return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
}

function parseMeta(metaRaw: string, pdfBase64: string): StoredPdfProject | null {
  try {
    const meta = JSON.parse(metaRaw) as ProjectMeta
    return {
      id: meta.id,
      name: meta.name,
      pageCount: meta.pageCount,
      annotations: Array.isArray(meta.annotations) ? meta.annotations : [],
      formValues: meta.formValues ?? {},
      updatedAt: meta.updatedAt,
      pdfBytes: base64ToBytes(pdfBase64),
    }
  } catch {
    return null
  }
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
