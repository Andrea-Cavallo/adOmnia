import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { KVRow } from '@/lib/types'
import { uid } from '@/lib/types'
import { cn } from '@/lib/utils'
import { VarHighlightInput } from '@/components/ui/VarHighlightInput'
import { useEnvironmentsStore } from '@/stores/environments'

interface KVEditorProps {
  rows: KVRow[]
  onChange: (rows: KVRow[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}

type Preset = readonly [key: string, value: string]

const HEADER_PRESET_GROUPS: { label: string; items: readonly Preset[] }[] = [
  {
    label: 'Common',
    items: [
      ['Accept', 'application/json'],
      ['Accept', 'application/xml'],
      ['Accept', '*/*'],
      ['Content-Type', 'application/json'],
      ['Content-Type', 'application/xml'],
      ['Content-Type', 'application/x-www-form-urlencoded'],
      ['Content-Type', 'multipart/form-data'],
      ['Content-Type', 'text/event-stream'],
      ['Authorization', 'Bearer {{access_token}}'],
      ['Authorization', 'Basic {{basic_credentials}}'],
      ['X-Client-Certificate', '{{client_certificate}}'],
      ['Idempotency-Key', '{{idempotency_key}}'],
      ['X-Request-ID', '{{request_id}}'],
      ['X-Correlation-ID', '{{correlation_id}}'],
      ['Cache-Control', 'no-cache, no-store, must-revalidate'],
      ['Cache-Control', 'no-cache, no-transform'],
      ['Cache-Control', 'public, max-age=300'],
    ],
  },
  {
    label: 'Content & Encoding',
    items: [
      ['Accept', 'application/problem+json'],
      ['Accept', 'application/graphql-response+json'],
      ['Accept', 'text/plain'],
      ['Accept', 'text/html'],
      ['Accept', 'text/csv'],
      ['Accept', 'application/pdf'],
      ['Content-Type', 'application/problem+json'],
      ['Content-Type', 'application/ld+json'],
      ['Content-Type', 'application/vnd.api+json'],
      ['Content-Type', 'application/hal+json'],
      ['Content-Type', 'application/json-patch+json'],
      ['Content-Type', 'application/merge-patch+json'],
      ['Content-Type', 'application/x-ndjson'],
      ['Content-Type', 'application/yaml'],
      ['Content-Type', 'application/cbor'],
      ['Content-Type', 'application/msgpack'],
      ['Content-Type', 'application/graphql'],
      ['Content-Type', 'application/octet-stream'],
      ['Content-Type', 'application/pdf'],
      ['Content-Type', 'application/soap+xml; charset=utf-8'],
      ['Content-Type', 'text/plain; charset=utf-8'],
      ['Content-Type', 'text/xml; charset=utf-8'],
      ['Content-Type', 'text/csv; charset=utf-8'],
      ['Content-Type', 'text/markdown; charset=utf-8'],
      ['Content-Type', 'multipart/mixed'],
      ['Content-Type', 'multipart/related'],
      ['Accept-Encoding', 'gzip, deflate, br'],
      ['Content-Encoding', 'gzip'],
      ['Accept-Language', 'en-US,en;q=0.9'],
      ['Content-Language', 'en'],
      ['Content-Disposition', 'attachment; filename="{{filename}}"'],
    ],
  },
  {
    label: 'Authentication & API Keys',
    items: [
      ['Authorization', 'ApiKey {{api_key}}'],
      ['Authorization', 'Digest {{digest_credentials}}'],
      ['Authorization', 'OAuth {{access_token}}'],
      ['Proxy-Authorization', 'Basic {{proxy_credentials}}'],
      ['X-API-Key', '{{api_key}}'],
      ['API-Key', '{{api_key}}'],
      ['X-Auth-Token', '{{auth_token}}'],
      ['X-Access-Token', '{{access_token}}'],
      ['X-Goog-Api-Key', '{{google_api_key}}'],
      ['X-RapidAPI-Key', '{{rapidapi_key}}'],
      ['X-RapidAPI-Host', '{{rapidapi_host}}'],
      ['CF-Access-Client-Id', '{{cloudflare_access_client_id}}'],
      ['CF-Access-Client-Secret', '{{cloudflare_access_client_secret}}'],
      ['Cookie', '{{cookie}}'],
    ],
  },
  {
    label: 'Cache & Conditional Requests',
    items: [
      ['Cache-Control', 'no-cache'],
      ['Cache-Control', 'no-store'],
      ['Cache-Control', 'max-age=0'],
      ['Pragma', 'no-cache'],
      ['If-Match', '{{etag}}'],
      ['If-None-Match', '{{etag}}'],
      ['If-Modified-Since', '{{http_date}}'],
      ['If-Unmodified-Since', '{{http_date}}'],
      ['If-Range', '{{etag_or_date}}'],
      ['Range', 'bytes=0-'],
      ['Prefer', 'return=representation'],
      ['Prefer', 'return=minimal'],
    ],
  },
  {
    label: 'Browser, CORS & Proxy',
    items: [
      ['Origin', '{{origin}}'],
      ['Referer', '{{referer}}'],
      ['User-Agent', '{{user_agent}}'],
      ['DNT', '1'],
      ['Sec-Fetch-Mode', 'cors'],
      ['Sec-Fetch-Site', 'same-origin'],
      ['Sec-Fetch-Dest', 'empty'],
      ['Access-Control-Request-Method', 'POST'],
      ['Access-Control-Request-Headers', 'authorization, content-type'],
      ['Forwarded', 'for={{client_ip}};proto=https;host={{host}}'],
      ['X-Forwarded-For', '{{client_ip}}'],
      ['X-Forwarded-Host', '{{host}}'],
      ['X-Forwarded-Proto', 'https'],
      ['X-Real-IP', '{{client_ip}}'],
      ['X-HTTP-Method-Override', 'PATCH'],
    ],
  },
  {
    label: 'Tracing & Request Context',
    items: [
      ['traceparent', '00-{{trace_id}}-{{span_id}}-01'],
      ['tracestate', '{{tracestate}}'],
      ['b3', '{{trace_id}}-{{span_id}}-1'],
      ['X-B3-TraceId', '{{trace_id}}'],
      ['X-B3-SpanId', '{{span_id}}'],
      ['X-B3-ParentSpanId', '{{parent_span_id}}'],
      ['X-B3-Sampled', '1'],
      ['X-Amzn-Trace-Id', 'Root={{aws_trace_id}}'],
      ['X-Request-ID', '{{request_id}}'],
      ['X-Correlation-ID', '{{correlation_id}}'],
      ['X-Client-Id', '{{client_id}}'],
      ['X-Tenant-Id', '{{tenant_id}}'],
      ['X-Environment', '{{environment}}'],
    ],
  },
  {
    label: 'Webhooks & Event APIs',
    items: [
      ['Stripe-Signature', '{{stripe_signature}}'],
      ['X-Hub-Signature-256', 'sha256={{webhook_signature}}'],
      ['X-Signature', '{{webhook_signature}}'],
      ['X-Webhook-Id', '{{webhook_id}}'],
      ['X-Webhook-Timestamp', '{{webhook_timestamp}}'],
      ['X-GitHub-Delivery', '{{github_delivery_id}}'],
      ['X-GitHub-Event', '{{github_event}}'],
      ['ce-id', '{{cloud_event_id}}'],
      ['ce-source', '{{cloud_event_source}}'],
      ['ce-specversion', '1.0'],
      ['ce-type', '{{cloud_event_type}}'],
    ],
  },
  {
    label: 'GraphQL & SOAP',
    items: [
      ['Accept', 'application/graphql-response+json, application/json'],
      ['X-Apollo-Operation-Name', '{{operation_name}}'],
      ['X-Apollo-Operation-Id', '{{operation_id}}'],
      ['Apollo-Require-Preflight', 'true'],
      ['SOAPAction', '{{soap_action}}'],
      ['MIME-Version', '1.0'],
    ],
  },
  {
    // Berlin Group NextGenPSD2 standard headers (XS2A).
    label: 'PSD2 / Berlin Group',
    items: [
      ['Consent-ID', '{{consent_id}}'],
      ['PSU-ID', '{{psu_id}}'],
      ['PSU-IP-Address', '{{psu_ip_address}}'],
      ['PSU-IP-Port', '{{psu_ip_port}}'],
      ['PSU-User-Agent', '{{psu_user_agent}}'],
      ['PSU-Http-Method', 'GET'],
      ['PSU-Device-ID', '{{psu_device_id}}'],
      ['PSU-Geo-Location', '{{psu_geo_location}}'],
      ['TPP-Redirect-URI', '{{tpp_redirect_uri}}'],
      ['TPP-Nok-Redirect-URI', '{{tpp_nok_redirect_uri}}'],
      ['TPP-Redirect-Preferred', 'true'],
      ['TPP-Explicit-Authorisation-Preferred', 'true'],
      ['Aspsp-Sca-Approach', 'REDIRECT'],
      ['Digest', '{{digest}}'],
      ['Signature', '{{signature}}'],
      ['TPP-Signature-Certificate', '{{tpp_signature_certificate}}'],
      ['Date', '{{http_date}}'],
    ],
  },
]

const HEADER_PRESETS: readonly Preset[] = HEADER_PRESET_GROUPS.flatMap((g) => g.items)

export function KVEditor({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value' }: KVEditorProps) {
  const isHeaders = keyPlaceholder.toLowerCase().includes('header')
  const [openId, setOpenId] = useState<string | null>(null)
  const [openValueId, setOpenValueId] = useState<string | null>(null)
  const [presetQuery, setPresetQuery] = useState('')
  const headerNames = Array.from(new Set(HEADER_PRESETS.map(([key]) => key)))
  const presetCount = HEADER_PRESETS.reduce<Record<string, number>>((acc, [key]) => { acc[key] = (acc[key] ?? 0) + 1; return acc }, {})
  const normalizedPresetQuery = presetQuery.trim().toLowerCase()
  const visiblePresetGroups = HEADER_PRESET_GROUPS
    .map((group) => ({
      ...group,
      items: normalizedPresetQuery
        ? group.items.filter(([key, value]) => `${key} ${value}`.toLowerCase().includes(normalizedPresetQuery))
        : group.items,
    }))
    .filter((group) => group.items.length > 0)
  const activeEnvId = useEnvironmentsStore((s) => s.activeEnvId)
  const getResolvedVars = useEnvironmentsStore((s) => s.getResolvedVars)
  const resolvedVars = getResolvedVars()
  const hasActiveEnv = activeEnvId !== null
  const update = (id: string, patch: Partial<KVRow>) => {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  const add = (key = '', value = '') => {
    onChange([...rows, { id: uid(), key, value, enabled: true }])
  }

  const remove = (id: string) => {
    const next = rows.filter((r) => r.id !== id)
    onChange(next.length ? next : [{ id: uid(), key: '', value: '', enabled: true }])
  }

  return (
    <div className="flex flex-col gap-0.5">
      <div className="grid grid-cols-[28px_1fr_1fr_28px] gap-1 px-2 py-1 text-[10px] uppercase tracking-wider text-text-4">
        <span />
        <span>{keyPlaceholder}</span>
        <span>{valuePlaceholder}</span>
        <span />
      </div>
      {rows.map((r) => (
        <div
          key={r.id}
          className={cn(
            'grid grid-cols-[28px_1fr_1fr_28px] gap-1 px-2 items-center group',
            !r.enabled && 'opacity-40'
          )}
        >
          <input
            type="checkbox"
            checked={r.enabled}
            onChange={(e) => update(r.id, { enabled: e.target.checked })}
            className="w-3.5 h-3.5 accent-accent rounded"
          />
          <div className="relative">
            <input
              className="w-full h-7 px-2 bg-surface-2 border border-border-2 rounded text-text-1 text-xs placeholder:text-text-4 focus:border-accent outline-none"
              placeholder={keyPlaceholder}
              value={r.key}
              onChange={(e) => update(r.id, { key: e.target.value })}
              onFocus={isHeaders ? () => setOpenId(r.id) : undefined}
              onBlur={isHeaders ? () => setTimeout(() => setOpenId((id) => (id === r.id ? null : id)), 120) : undefined}
            />
            {isHeaders && openId === r.id && (() => {
              const matches = headerNames.filter((n) => n.toLowerCase().includes(r.key.toLowerCase()) && n !== r.key)
              if (matches.length === 0) return null
              return (
                <div className="absolute left-0 top-[calc(100%+2px)] z-30 w-full max-h-48 overflow-y-auto rounded-md border border-border-2 bg-surface-1 shadow-lg py-1">
                  {matches.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        update(r.id, { key: name })
                        setOpenId(null)
                      }}
                      className="block w-full px-3 py-1.5 text-left text-xs text-text-2 hover:bg-surface-2 hover:text-text-1"
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
          <div
            className="relative h-7 overflow-visible rounded border border-border-2 bg-surface-2 focus-within:border-accent"
            onFocusCapture={isHeaders ? () => setOpenValueId(r.id) : undefined}
            onBlurCapture={isHeaders ? () => setTimeout(() => setOpenValueId((id) => (id === r.id ? null : id)), 120) : undefined}
          >
            <VarHighlightInput
              value={r.value}
              onChange={(value) => update(r.id, { value })}
              resolvedVars={resolvedVars}
              hasActiveEnv={hasActiveEnv}
              placeholder={valuePlaceholder}
              className="h-full"
            />
            {isHeaders && openValueId === r.id && (() => {
              const values = Array.from(new Set(
                HEADER_PRESETS
                  .filter(([key]) => key.toLowerCase() === r.key.trim().toLowerCase())
                  .map(([, value]) => value),
              )).filter((value) => value.toLowerCase().includes(r.value.toLowerCase()))
              if (values.length === 0) return null
              return (
                <div className="absolute left-0 top-[calc(100%+2px)] z-40 w-full max-h-48 overflow-y-auto rounded-md border border-border-2 bg-surface-1 py-1 shadow-lg">
                  <div className="px-2.5 pb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">Value presets</div>
                  {values.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        update(r.id, { value })
                        setOpenValueId(null)
                      }}
                      className="block w-full truncate px-2.5 py-1.5 text-left font-mono text-[11px] text-text-2 hover:bg-surface-2 hover:text-text-1"
                      title={value}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
          <button
            onClick={() => remove(r.id)}
            title="Remove row"
            className="w-6 h-6 flex items-center justify-center text-text-4 hover:text-error rounded opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => add()}
        className="flex items-center gap-1 px-2 py-1 mt-1 text-xs text-text-3 hover:text-text-1 transition-colors"
      >
        <Plus size={12} /> Add row
      </button>
      {isHeaders && (
        <div className="max-h-64 overflow-y-auto px-2 pb-2 pt-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-text-4">Header presets</span>
            <input
              value={presetQuery}
              onChange={(event) => setPresetQuery(event.target.value)}
              placeholder="Filter presets…"
              className="h-6 min-w-0 flex-1 rounded border border-border-2 bg-surface-2 px-2 font-mono text-[10px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent"
            />
          </div>
          {visiblePresetGroups.map((group) => (
            <div key={group.label} className="mb-1.5 last:mb-0">
              <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-text-4">{group.label}</div>
              <div className="flex flex-wrap gap-1">
                {group.items.map(([key, value]) => (
                  <button
                    key={`${key}:${value}`}
                    onClick={() => add(key, value)}
                    className="rounded border border-border-2 bg-surface-1 px-2 py-0.5 text-[10px] text-text-3 hover:border-accent/50 hover:text-text-1"
                    title={`${key}: ${value}`}
                  >
                    {presetCount[key] > 1 ? `${key}: ${value}` : key}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {visiblePresetGroups.length === 0 && (
            <div className="py-2 text-center text-[10px] text-text-4">No header presets match this filter.</div>
          )}
        </div>
      )}
    </div>
  )
}
