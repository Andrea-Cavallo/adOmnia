import { stringify } from 'yaml'
import { collectionsToOAS } from '@/lib/oasExport'
import { ensureAIConfigured } from '@/lib/aiEngine'
import type { Collection } from '@/lib/types'
import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { buildApiDocModel, parseSpecText } from './parseSpec'

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim()
  const fenced = trimmed.match(/^```(?:json|yaml|yml)?\s*([\s\S]*?)\s*```$/i)
  return (fenced?.[1] ?? trimmed).trim()
}

function normalizeSpecText(raw: string): string {
  const spec = parseSpecText(stripMarkdownFence(raw))
  const model = buildApiDocModel(spec)
  if (model.operationCount === 0) {
    throw new Error('AI returned a spec without operations.')
  }
  return stringify(spec, { lineWidth: 0 })
}

export async function generateApiDocsWithAI(collections: Collection[]): Promise<string> {
  if (collections.length === 0) throw new Error('Select at least one collection before generating docs.')
  const baseSpec = collectionsToOAS(collections, 'yaml')
  await ensureAIConfigured()
  const raw = await AIEngine.Complete(
    'You are an API documentation assistant for adOmnia. Return only a complete valid OpenAPI 3.0 YAML document. Do not wrap it in Markdown.',
    [
      'Create or improve API documentation for this collection export.',
      'Preserve every existing path, method, parameter, request body, response status, and schema.',
      'Add professional summaries and descriptions where they are missing.',
      'Keep the output local-first and vendor-neutral. Do not invent authentication secrets or external services.',
      '',
      baseSpec,
    ].join('\n'),
    4096,
  )
  return normalizeSpecText(raw)
}

export async function improveApiDocsWithAI(specText: string): Promise<string> {
  if (!specText.trim()) throw new Error('No API document is loaded.')
  await ensureAIConfigured()
  const raw = await AIEngine.Complete(
    'You improve OpenAPI documentation. Return only a complete valid OpenAPI 3.0 YAML document. Do not wrap it in Markdown.',
    [
      'Improve this API document for a developer-facing reference.',
      'Preserve every path, method, parameter, request body, response status, and schema.',
      'Add or improve operation summaries, descriptions, tag descriptions, and response descriptions.',
      'Do not remove operations. Do not add fake secrets. Do not add telemetry or cloud assumptions.',
      '',
      specText,
    ].join('\n'),
    4096,
  )
  return normalizeSpecText(raw)
}
