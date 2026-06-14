import { UploadCloud } from 'lucide-react'

export function DropOverlay() {
  return (
    <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm pointer-events-none">
      <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-accent bg-surface-1 p-8 shadow-2xl">
        <UploadCloud size={48} strokeWidth={1.5} className="text-accent" />
        <p className="text-sm font-semibold text-text-1">Drop a file to open it</p>
        <p className="text-[10px] text-text-3">Postman / OpenAPI / Insomnia / Mermaid / PDF / HAR / WSDL / Java Class</p>
      </div>
    </div>
  )
}
