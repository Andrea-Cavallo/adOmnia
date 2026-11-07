/**
 * The left half of a gRPC tab, the twin of the REST and WebSocket composers: one row of sections over the
 * message, metadata, auth, schema, TLS, settings and the mock.
 */
import { useState } from 'react'
import { AlertTriangle, FileKey } from 'lucide-react'
import { AuthEditor } from '@/components/composer/AuthEditor'
import { KVEditor } from '@/components/composer/KVEditor'
import { cn } from '@/lib/utils'
import { useUiTranslation } from '@/lib/uiI18n'
import { pickFile } from '@/lib/fileDialogs'
import { blankAuth, type GrpcSettings, type RequestItem } from '@/lib/types'
import { grpcSettings, parseGrpcAddress } from '@/lib/grpc/grpcRequest'
import { MiniButton, NumberField, SectionBlock, Toggle } from '@/components/websocket/wsUi'
import { GrpcMessageSection } from './GrpcMessageSection'
import { GrpcSchemaSection } from './GrpcSchemaSection'
import { GrpcMockSection } from './GrpcMockSection'
import { GrpcLoadSection } from './GrpcLoadSection'

type GrpcSection = 'message' | 'metadata' | 'auth' | 'schema' | 'tls' | 'settings' | 'mock' | 'load'
const PRIMARY_SECTIONS: GrpcSection[] = ['message', 'metadata', 'auth', 'schema', 'tls']
const MAX_TIMEOUT_MS = 600_000
const CERTIFICATES = 'Certificates'
const CERTIFICATE_PATTERN = '*.pem;*.crt;*.cer;*.key'

const countRows = (rows: RequestItem['headers']) => (rows ?? []).filter((row) => row.enabled && row.key.trim()).length

export interface GrpcComposerProps {
  tabId: string
  request: RequestItem
  vars: Record<string, string>
  onChange: (request: RequestItem) => void
}

function CertificateField({ label, value, onChange }: { label: string; value: string; onChange: (path: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-text-3">
      {label}
      <span className="flex items-center gap-1.5">
        <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="/path/to/file.pem" className="h-8 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11.5px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50" />
        <MiniButton onClick={() => void pickFile(label, CERTIFICATES, CERTIFICATE_PATTERN).then((path) => { if (path) onChange(path) })}><FileKey size={12} /> Choose</MiniButton>
      </span>
    </label>
  )
}

function TlsSection({ settings, address, onChange }: { settings: GrpcSettings; address: string; onChange: (patch: Partial<GrpcSettings>) => void }) {
  const fromScheme = parseGrpcAddress(address).tls
  return (
    <>
      <SectionBlock title="Transport" hint={fromScheme === undefined ? 'Plaintext is the default for local servers; production servers usually need TLS.' : `The address says ${fromScheme ? 'grpcs:// (TLS)' : 'grpc:// (plaintext)'}: it wins over this switch.`}>
        <Toggle checked={fromScheme ?? settings.tls} onChange={(tls) => onChange({ tls })} label="Use TLS" />
      </SectionBlock>
      <SectionBlock title="Certificates" hint="A custom CA for private servers, and a client certificate and key for mTLS. Files stay where they are; only their paths are saved.">
        <div className="flex flex-col gap-2">
          <CertificateField label="CA certificate" value={settings.caCertPath} onChange={(caCertPath) => onChange({ caCertPath })} />
          <CertificateField label="Client certificate" value={settings.clientCertPath} onChange={(clientCertPath) => onChange({ clientCertPath })} />
          <CertificateField label="Client key" value={settings.clientKeyPath} onChange={(clientKeyPath) => onChange({ clientKeyPath })} />
        </div>
      </SectionBlock>
    </>
  )
}

function AuthNotice({ type }: { type: string }) {
  if (['none', 'bearer', 'basic', 'apikey', 'oauth2'].includes(type)) return null
  return (
    <div className="mx-3 mt-3 flex items-start gap-2 rounded border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
      <span>gRPC sends auth as metadata: Bearer, Basic, API Key and an OAuth 2.0 token are supported. Use Metadata for anything else.</span>
    </div>
  )
}

export function GrpcComposer({ tabId, request, vars, onChange }: GrpcComposerProps) {
  const tr = useUiTranslation()
  const [section, setSection] = useState<GrpcSection>('message')
  const settings = grpcSettings(request)
  const setSettings = (patch: Partial<GrpcSettings>) => onChange({ ...request, grpc: { ...settings, ...patch } })
  const auth = request.auth ?? blankAuth()

  const sections: Array<{ id: GrpcSection; label: string; count: number }> = [
    { id: 'message', label: tr('Message'), count: request.bodies?.length ?? 0 },
    { id: 'metadata', label: 'Metadata', count: countRows(request.headers) },
    { id: 'auth', label: tr('Auth'), count: auth.type === 'none' ? 0 : 1 },
    { id: 'schema', label: 'Schema', count: settings.source === 'reflection' ? 0 : settings.protoFiles.length + (settings.protosetPath ? 1 : 0) + Object.keys(settings.inlineProtos ?? {}).length },
    { id: 'tls', label: 'TLS', count: (settings.tls ? 1 : 0) + (settings.clientCertPath ? 1 : 0) },
    { id: 'settings', label: tr('Settings'), count: settings.timeoutMs > 0 ? 1 : 0 },
    { id: 'mock', label: 'Mock', count: settings.mockRules?.length ?? 0 },
    { id: 'load', label: 'Load test', count: 0 },
  ]

  return (
    <div data-grpc-composer className="flex min-h-0 flex-1 flex-col border-b border-border-1">
      <div className="api-section-strip flex items-stretch border-b border-border-1">
        <div role="tablist" aria-label="gRPC call sections" className="flex min-w-0 flex-1 flex-nowrap items-stretch gap-0.5 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {sections.filter((item) => PRIMARY_SECTIONS.includes(item.id)).map((item) => {
            const active = section === item.id
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={active}
                onClick={() => setSection(item.id)}
                className={cn(
                  'relative flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[11.5px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
                  active ? 'border-accent text-text-1' : 'border-transparent text-text-3 hover:text-text-1',
                )}
              >
                <span>{item.label}</span>
                {item.count > 0 && <span className={cn('inline-flex min-w-4 items-center justify-center rounded px-1 py-px font-mono text-[9px] font-semibold', active ? 'bg-accent/25 text-accent-light' : 'bg-surface-3 text-text-2')}>{item.count}</span>}
              </button>
            )
          })}
        </div>
        <select aria-label={tr('More')} className="api-section-more" value={PRIMARY_SECTIONS.includes(section) ? '' : section} onChange={(event) => { if (event.target.value) setSection(event.target.value as GrpcSection) }}>
          <option value="" disabled>{tr('More')}</option>
          {sections.filter((item) => !PRIMARY_SECTIONS.includes(item.id)).map((item) => <option key={item.id} value={item.id}>{item.label}{item.count ? ` · ${item.count}` : ''}</option>)}
        </select>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {section === 'message' && <GrpcMessageSection tabId={tabId} request={request} vars={vars} onChange={onChange} />}
        {section === 'metadata' && <KVEditor rows={request.headers ?? []} onChange={(headers) => onChange({ ...request, headers })} keyPlaceholder="Metadata key" valuePlaceholder="Value" />}
        {section === 'auth' && (
          <>
            <AuthNotice type={auth.type} />
            <AuthEditor auth={auth} onChange={(next) => onChange({ ...request, auth: next })} />
          </>
        )}
        {section === 'schema' && <GrpcSchemaSection tabId={tabId} request={request} vars={vars} onChange={onChange} />}
        {section === 'tls' && <TlsSection settings={settings} address={request.url} onChange={setSettings} />}
        {section === 'settings' && (
          <SectionBlock title="Deadline" hint="How long the call may take before it is cancelled with DEADLINE_EXCEEDED. 0 uses the default (30 s); an interactive stream stays open up to 30 minutes.">
            <NumberField label="Timeout" min={0} value={settings.timeoutMs} max={MAX_TIMEOUT_MS} onChange={(timeoutMs) => setSettings({ timeoutMs })} suffix="ms" />
          </SectionBlock>
        )}
        {section === 'mock' && <GrpcMockSection tabId={tabId} request={request} onChange={onChange} />}
        {section === 'load' && <GrpcLoadSection request={request} vars={vars} />}
      </div>
    </div>
  )
}
