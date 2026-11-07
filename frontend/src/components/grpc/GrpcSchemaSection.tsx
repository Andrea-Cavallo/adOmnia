/**
 * Where the call takes its schema from. Server reflection asks the server; many production servers turn it off,
 * so the call can also be described by .proto files (with import paths, like protoc) or a compiled protoset.
 * Paths are kept, not copies: the request follows the .proto files as they change.
 */
import { useState } from 'react'
import { FileCode2, FolderOpen, Loader2, Plus, RefreshCw, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pickFile, pickFolder } from '@/lib/fileDialogs'
import type { GrpcDescriptorKind, GrpcSettings, RequestItem } from '@/lib/types'
import { grpcSettings } from '@/lib/grpc/grpcRequest'
import { grpcDescriptorsOf, useGrpcDescriptors } from '@/stores/grpcDescriptors'
import { MiniButton, SectionBlock } from '@/components/websocket/wsUi'

const SOURCES: Array<{ id: GrpcDescriptorKind; label: string; hint: string }> = [
  { id: 'reflection', label: 'Server reflection', hint: 'The server describes itself. Needs reflection enabled on the server.' },
  { id: 'proto', label: '.proto files', hint: 'Works with any server. Imports are looked up in the import paths, then next to each file.' },
  { id: 'protoset', label: 'Protoset', hint: 'A compiled FileDescriptorSet (protoc --descriptor_set_out --include_imports).' },
]
const IDLE = grpcDescriptorsOf('')

function PathList({ paths, empty, onRemove }: { paths: string[]; empty: string; onRemove: (index: number) => void }) {
  if (!paths.length) return <p className="rounded border border-dashed border-border-2 px-3 py-2 text-[11px] text-text-4">{empty}</p>
  return (
    <ul className="flex flex-col gap-1">
      {paths.map((path, index) => (
        <li key={path} className="flex h-7 items-center gap-2 rounded border border-border-2 bg-surface-0 px-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-text-1" title={path}>{path}</span>
          <button type="button" onClick={() => onRemove(index)} aria-label={`Remove ${path}`} className="grid h-5 w-5 place-items-center rounded text-text-4 hover:bg-error/10 hover:text-error"><X size={11} /></button>
        </li>
      ))}
    </ul>
  )
}

/** A path typed by hand: the browser preview has no native picker, and pasting a path is often faster. */
function PathInput({ placeholder, onAdd }: { placeholder: string; onAdd: (path: string) => void }) {
  const [value, setValue] = useState('')
  const add = () => {
    if (value.trim()) onAdd(value.trim())
    setValue('')
  }
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }}
        placeholder={placeholder}
        className="h-7 min-w-0 flex-1 rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
      />
      <MiniButton onClick={add} disabled={!value.trim()}><Plus size={12} /> Add</MiniButton>
    </div>
  )
}

export function GrpcSchemaSection({ tabId, request, vars, onChange }: { tabId: string; request: RequestItem; vars: Record<string, string>; onChange: (request: RequestItem) => void }) {
  const settings = grpcSettings(request)
  const schema = useGrpcDescriptors((state) => state.byTab[tabId]) ?? IDLE
  const load = useGrpcDescriptors((state) => state.load)
  const update = (patch: Partial<GrpcSettings>) => onChange({ ...request, grpc: { ...settings, ...patch } })
  const addUnique = (list: string[], path: string) => (path && !list.includes(path) ? [...list, path] : list)
  const inline = Object.keys(settings.inlineProtos ?? {})
  const services = schema.descriptors?.services ?? []
  const methods = services.reduce((total, service) => total + service.methods.length, 0)

  return (
    <>
      <SectionBlock title="Schema source" hint={SOURCES.find((source) => source.id === settings.source)?.hint}>
        <div className="flex flex-wrap items-center gap-1 rounded border border-border-2 bg-surface-1 p-0.5" role="radiogroup" aria-label="Schema source">
          {SOURCES.map((source) => (
            <button
              key={source.id}
              type="button"
              role="radio"
              aria-checked={settings.source === source.id}
              onClick={() => update({ source: source.id })}
              className={cn('h-7 flex-1 rounded px-3 text-[11.5px] font-medium transition-colors', settings.source === source.id ? 'bg-accent/15 text-accent' : 'text-text-3 hover:text-text-1')}
            >
              {source.label}
            </button>
          ))}
        </div>
      </SectionBlock>

      {settings.source === 'proto' && (
        <>
          <SectionBlock title=".proto files" right={<MiniButton onClick={() => void pickFile('Add a .proto file', 'Protocol Buffers', '*.proto').then((path) => update({ protoFiles: addUnique(settings.protoFiles, path) }))}><FileCode2 size={12} /> Add file</MiniButton>}>
            <PathList paths={settings.protoFiles} empty="No .proto file yet: add the file that declares the service." onRemove={(index) => update({ protoFiles: settings.protoFiles.filter((_, position) => position !== index) })} />
            <PathInput placeholder="/path/to/service.proto" onAdd={(path) => update({ protoFiles: addUnique(settings.protoFiles, path) })} />
            {inline.length > 0 && (
              <p className="mt-2 text-[11px] text-text-4">Also kept inline: {inline.join(', ')}{' '}
                <button type="button" onClick={() => update({ inlineProtos: undefined })} className="text-accent hover:underline">Drop</button>
              </p>
            )}
          </SectionBlock>
          <SectionBlock title="Import paths" hint="Folders where imports such as common/money.proto are found. The folder of each file is always searched too." right={<MiniButton onClick={() => void pickFolder('Add an import path').then((path) => update({ importPaths: addUnique(settings.importPaths, path) }))}><FolderOpen size={12} /> Add folder</MiniButton>}>
            <PathList paths={settings.importPaths} empty="None: imports are looked up next to each file." onRemove={(index) => update({ importPaths: settings.importPaths.filter((_, position) => position !== index) })} />
            <PathInput placeholder="/path/to/protos" onAdd={(path) => update({ importPaths: addUnique(settings.importPaths, path) })} />
          </SectionBlock>
        </>
      )}

      {settings.source === 'protoset' && (
        <SectionBlock title="Protoset file" right={<MiniButton onClick={() => void pickFile('Choose a protoset', 'Descriptor sets', '*.protoset;*.pb;*.bin;*.desc').then((path) => { if (path) update({ protosetPath: path }) })}><FileCode2 size={12} /> Choose</MiniButton>}>
          <input
            value={settings.protosetPath}
            onChange={(event) => update({ protosetPath: event.target.value })}
            placeholder="/path/to/api.protoset"
            className="h-8 w-full rounded border border-border-2 bg-surface-0 px-2 font-mono text-[11.5px] text-text-1 outline-none placeholder:text-text-4 focus:border-accent/50"
          />
        </SectionBlock>
      )}

      <SectionBlock
        title="Services"
        right={(
          <MiniButton onClick={() => void load(tabId, request, vars)} disabled={schema.loading || (settings.source === 'reflection' && !request.url.trim())}>
            {schema.loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {settings.source === 'reflection' ? 'Reflect' : 'Load'}
          </MiniButton>
        )}
      >
        {schema.error && <p className="mb-2 whitespace-pre-wrap rounded border border-error/30 bg-error/10 px-2 py-1.5 font-mono text-[11px] text-error">{schema.error}</p>}
        {!schema.descriptors && !schema.error && <p className="text-[11px] text-text-4">{settings.source === 'reflection' ? 'Set the address, then Reflect.' : 'Add the schema files, then Load.'}</p>}
        {schema.descriptors && (
          <>
            <p className="mb-1.5 text-[11px] text-text-3">{services.length} service{services.length === 1 ? '' : 's'}, {methods} method{methods === 1 ? '' : 's'} · {schema.origin}</p>
            <ul className="flex flex-col gap-0.5 font-mono text-[11px]">
              {services.map((service) => (
                <li key={service.name} className="truncate text-text-2" title={service.methods.map((method) => method.name).join(', ')}>
                  {service.name} <span className="text-text-4">· {service.methods.length}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </SectionBlock>
    </>
  )
}
