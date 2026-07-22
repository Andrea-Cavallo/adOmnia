// Editor-facing helpers for the Swagger workspace: parsing with line info for
// inline error markers, formatting, and YAML<->JSON conversion.

import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { parseYamlLenient } from '@/lib/yamlParse'
import { buildApiDocModel, type ApiDocModel } from './parseSpec'

export type SpecLanguage = 'yaml' | 'json'

export interface SpecParseError {
  message: string
  line?: number
  column?: number
}

export interface SpecParseResult {
  model?: ApiDocModel
  error?: SpecParseError
}

/** Guess the language from the raw text (leading `{` or `[` means JSON). */
export function detectLanguage(raw: string): SpecLanguage {
  const t = raw.trimStart()
  return t.startsWith('{') || t.startsWith('[') ? 'json' : 'yaml'
}

/**
 * Parse a spec for the editor, returning either a render model or a structured
 * error carrying the offending line so the editor can place a marker on it.
 */
export function parseSpecForEditor(raw: string, language: SpecLanguage): SpecParseResult {
  if (!raw.trim()) return { error: { message: 'Empty document', line: 1 } }
  try {
    const doc = language === 'json' ? JSON.parse(raw) : parseYamlLenient(raw)
    const model = buildApiDocModel(doc)
    if (model.operationCount === 0) {
      return { model, error: { message: 'No operations (paths) found in this document.', line: 1 } }
    }
    return { model }
  } catch (e: unknown) {
    return { error: toParseError(e, raw) }
  }
}

function toParseError(e: unknown, raw: string): SpecParseError {
  const message = e instanceof Error ? e.message : 'Could not parse the document'
  // yaml errors expose linePos; JSON.parse errors expose a character position.
  const yamlPos = (e as { linePos?: Array<{ line: number; col: number }> })?.linePos?.[0]
  if (yamlPos) return { message, line: yamlPos.line, column: yamlPos.col }
  const jsonPos = /position (\d+)/.exec(message)
  if (jsonPos) {
    const index = Number(jsonPos[1])
    const line = raw.slice(0, index).split(/\r?\n/).length
    return { message, line }
  }
  const lineMatch = /line (\d+)/i.exec(message)
  if (lineMatch) return { message, line: Number(lineMatch[1]) }
  return { message, line: 1 }
}

/** Pretty-print the document in its own language. Throws if it does not parse. */
export function formatSpec(raw: string, language: SpecLanguage): string {
  if (language === 'json') return JSON.stringify(JSON.parse(raw), null, 2)
  // ponytail: round-trips through the object model, so YAML comments are dropped.
  return stringifyYaml(parseYaml(raw), { indent: 2, lineWidth: 0 })
}

/** Convert the document between YAML and JSON. Throws if it does not parse. */
export function convertSpec(raw: string, from: SpecLanguage, to: SpecLanguage): string {
  if (from === to) return raw
  const obj = from === 'json' ? JSON.parse(raw) : parseYamlLenient(raw)
  return to === 'json' ? JSON.stringify(obj, null, 2) : stringifyYaml(obj, { indent: 2, lineWidth: 0 })
}

export const STARTER_SPEC = `openapi: 3.1.0
info:
  title: New API
  version: 1.0.0
  description: |
    Start editing on the left — the documentation on the right updates live.
servers:
  - url: https://api.example.com/v1
tags:
  - name: items
    description: Item catalog
paths:
  /items:
    get:
      tags: [items]
      summary: List items
      operationId: listItems
      parameters:
        - name: limit
          in: query
          required: false
          schema:
            type: integer
            default: 20
      responses:
        '200':
          description: A page of items
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Item'
    post:
      tags: [items]
      summary: Create an item
      operationId: createItem
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Item'
      responses:
        '201':
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Item'
    query:
      tags: [items]
      summary: Query items with a body (OpenAPI 3.2 QUERY method)
      operationId: queryItems
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                filter:
                  type: string
      responses:
        '200':
          description: Matching items
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Item'
components:
  schemas:
    Item:
      type: object
      required: [id, name]
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        price:
          type: number
`
