import { AlertTriangle, Database, FileArchive, FileCode2, FileJson, FileText, UploadCloud } from 'lucide-react'
import type { DropPreview } from '@/hooks/useFileDrop'
import { useUiTranslation } from '@/lib/uiI18n'

interface DropOverlayProps {
  preview: DropPreview | null
}

function previewIcon(kind: string) {
  if (kind === 'PDF' || kind === 'LaTeX' || kind === 'WSDL') return FileText
  if (kind === 'HAR' || kind === 'Collection' || kind === 'Workspace') return FileJson
  if (kind === 'Proto' || kind === 'Java Class') return FileCode2
  if (kind === 'SQL') return Database
  if (kind === 'Mermaid') return FileArchive
  return UploadCloud
}

const primaryDropTypes = ['.har', '.wsdl', '.adomnia', '.json', '.yaml', '.pdf']

export function DropOverlay({ preview }: DropOverlayProps) {
  const tr = useUiTranslation()
  const Icon = preview?.supported === false ? AlertTriangle : preview ? previewIcon(preview.kind) : UploadCloud

  return (
    <div className="pointer-events-none absolute inset-0 z-[9999] flex items-center justify-center bg-black/[0.64] p-6 backdrop-blur-md drop-overlay-enter">
      <div className="absolute inset-3 rounded-lg border border-dashed border-accent/35" />
      <div className="glass-panel relative flex w-[min(560px,calc(100vw-48px))] flex-col items-center gap-4 overflow-hidden rounded-lg border border-accent/55 p-8 text-center shadow-2xl shadow-black/50">
        <div className="absolute inset-3 rounded-md border border-dashed border-accent/28" />
        <div className="relative grid h-16 w-16 place-items-center rounded-lg border border-border-2 bg-surface-2 shadow-[var(--shadow-glow)]">
          <Icon
            size={34}
            strokeWidth={1.45}
            className={preview?.supported === false ? 'text-warning' : 'text-accent'}
          />
        </div>
        <div className="relative min-w-0">
          <p className="text-sm font-semibold text-text-1">
            {preview?.supported === false ? tr('This file type is not supported') : preview ? `${tr('Drop to open in')} ${preview.target}` : tr('Drop a file to open it')}
          </p>
          <p className="mt-1 max-w-[440px] truncate font-mono text-[11px] text-text-3">
            {preview ? preview.name : 'Postman / OpenAPI / Insomnia / Mermaid / LaTeX / PDF / HAR / WSDL / Java Class'}
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-[10px] text-text-4">
          <span className="rounded border border-border-2 bg-surface-2 px-2 py-0.5">{preview?.kind ?? tr('Auto detect')}</span>
          <span>{preview?.target ?? tr('Route to the right local tool')}</span>
        </div>
        <div className="relative flex max-w-full flex-wrap justify-center gap-1.5">
          {primaryDropTypes.map((type) => (
            <span
              key={type}
              className="rounded border border-border-2 bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-3"
            >
              {type}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
