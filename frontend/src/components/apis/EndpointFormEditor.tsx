import { useState, useEffect } from 'react'
import { Save } from 'lucide-react'
import { ParameterTable, type OASParam } from './ParameterTable'
import { cn } from '@/lib/utils'

export interface EndpointDef {
  method: string
  path: string
  summary: string
  description: string
  pathParams: OASParam[]
  queryParams: OASParam[]
  headerParams: OASParam[]
  hasRequestBody: boolean
  requestBodyContentType: string
  requestBodySchema: string
  responses: ResponseDef[]
}

export interface ResponseDef {
  statusCode: string
  description: string
  schema: string
}

interface Props {
  endpoint: EndpointDef
  onSave: (updated: EndpointDef) => void
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

// Reuse the app's method-color design tokens for visual cohesion.
const METHOD_COLORS: Record<string, string> = {
  GET: 'text-method-get',
  POST: 'text-method-post',
  PUT: 'text-method-put',
  PATCH: 'text-method-patch',
  DELETE: 'text-method-delete',
  HEAD: 'text-method-head',
  OPTIONS: 'text-method-head',
}

type EditorTab = 'parameters' | 'body' | 'responses'

export function EndpointFormEditor({ endpoint, onSave }: Props) {
  const [form, setForm] = useState<EndpointDef>(endpoint)
  const [tab, setTab] = useState<EditorTab>('parameters')

  useEffect(() => {
    setForm(endpoint)
  }, [endpoint])

  const update = (patch: Partial<EndpointDef>) => setForm((f) => ({ ...f, ...patch }))

  const addResponse = () =>
    update({ responses: [...form.responses, { statusCode: '200', description: 'OK', schema: '' }] })
  const removeResponse = (i: number) => update({ responses: form.responses.filter((_, idx) => idx !== i) })
  const updateResponse = (i: number, patch: Partial<ResponseDef>) =>
    update({ responses: form.responses.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) })

  return (
    <div className="flex flex-col h-full overflow-hidden flex-1">
      {/* Method + Path */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-1 bg-surface-1">
        <select
          value={form.method}
          onChange={(e) => update({ method: e.target.value })}
          className={cn(
            'h-7 px-2 text-[10px] font-mono font-bold bg-surface-2 rounded border border-border-2 focus:border-accent outline-none',
            METHOD_COLORS[form.method] ?? 'text-text-2',
          )}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          value={form.path}
          onChange={(e) => update({ path: e.target.value })}
          placeholder="/api/users/{id}"
          className="flex-1 h-7 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
        />
        <button
          onClick={() => onSave(form)}
          className="h-7 px-3 flex items-center gap-1.5 text-[10px] bg-accent text-white rounded hover:bg-accent-hover transition-colors"
        >
          <Save size={11} />
          Save
        </button>
      </div>

      {/* Summary */}
      <div className="px-4 py-2 border-b border-border-1 space-y-2">
        <input
          value={form.summary}
          onChange={(e) => update({ summary: e.target.value })}
          placeholder="Summary (short description)"
          className="w-full h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
        />
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border-1 px-4 gap-1">
        {(['parameters', 'body', 'responses'] as EditorTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-2 text-[10px] capitalize font-medium border-b-2 transition-colors',
              tab === t ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {tab === 'parameters' && (
          <>
            {form.pathParams.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-text-2 mb-2">Path Parameters</p>
                <ParameterTable params={form.pathParams} onChange={(p) => update({ pathParams: p })} disableInChange />
              </div>
            )}
            <div>
              <p className="text-[10px] font-medium text-text-2 mb-2">Query Parameters</p>
              <ParameterTable params={form.queryParams} onChange={(p) => update({ queryParams: p })} />
            </div>
            <div>
              <p className="text-[10px] font-medium text-text-2 mb-2">Header Parameters</p>
              <ParameterTable params={form.headerParams} onChange={(p) => update({ headerParams: p })} />
            </div>
          </>
        )}

        {tab === 'body' && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-[10px] text-text-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.hasRequestBody}
                onChange={(e) => update({ hasRequestBody: e.target.checked })}
                className="w-3 h-3 accent-[var(--color-accent)]"
              />
              This endpoint has a request body
            </label>
            {form.hasRequestBody && (
              <>
                <div>
                  <label className="text-[10px] font-medium text-text-2 block mb-1">Content Type</label>
                  <select
                    value={form.requestBodyContentType}
                    onChange={(e) => update({ requestBodyContentType: e.target.value })}
                    className="h-7 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none"
                  >
                    <option value="application/json">application/json</option>
                    <option value="application/x-www-form-urlencoded">application/x-www-form-urlencoded</option>
                    <option value="multipart/form-data">multipart/form-data</option>
                    <option value="text/plain">text/plain</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-medium text-text-2 block mb-1">Schema (JSON Schema or $ref)</label>
                  <textarea
                    value={form.requestBodySchema}
                    onChange={(e) => update({ requestBodySchema: e.target.value })}
                    placeholder={'{"type":"object","properties":{"name":{"type":"string"}}}'}
                    rows={6}
                    className="w-full px-2 py-1.5 text-[10px] font-mono bg-surface-1 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none resize-y"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'responses' && (
          <div className="space-y-3">
            {form.responses.map((resp, i) => (
              <div key={i} className="border border-border-1 rounded p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    value={resp.statusCode}
                    onChange={(e) => updateResponse(i, { statusCode: e.target.value })}
                    placeholder="200"
                    className="h-6 px-2 text-[10px] font-mono bg-surface-2 border border-border-2 rounded text-text-1 focus:border-accent outline-none w-[60px]"
                  />
                  <input
                    value={resp.description}
                    onChange={(e) => updateResponse(i, { description: e.target.value })}
                    placeholder="Description"
                    className="flex-1 h-6 px-2 text-[10px] bg-surface-2 border border-border-2 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none"
                  />
                  <button
                    onClick={() => removeResponse(i)}
                    className="h-6 w-6 flex items-center justify-center rounded hover:bg-surface-3 text-text-4 hover:text-error transition-colors"
                    title="Remove response"
                  >
                    <span className="text-[11px]">×</span>
                  </button>
                </div>
                <textarea
                  value={resp.schema}
                  onChange={(e) => updateResponse(i, { schema: e.target.value })}
                  placeholder={'{"type":"object"} or {"$ref":"#/components/schemas/User"}'}
                  rows={3}
                  className="w-full px-2 py-1 text-[9px] font-mono bg-surface-1 border border-border-1 rounded text-text-1 placeholder:text-text-4 focus:border-accent outline-none resize-y"
                />
              </div>
            ))}
            <button
              onClick={addResponse}
              className="flex items-center gap-1.5 h-6 px-2 text-[9px] text-text-3 hover:text-text-1 hover:bg-surface-2 rounded transition-colors"
            >
              <span className="text-[14px] leading-none">+</span>
              Add response
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
