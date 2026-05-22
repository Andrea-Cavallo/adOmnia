import { useState } from 'react'
import { UploadCloud } from 'lucide-react'
import { cn } from '@/lib/utils'

export function FileDropZone({
  accept,
  label,
  detail,
  onFile,
  multiple = false,
  onFiles,
}: {
  accept: string
  label: string
  detail: string
  onFile: (file: File) => void
  multiple?: boolean
  onFiles?: (files: File[]) => void
}) {
  const [dragging, setDragging] = useState(false)
  return (
    <label
      onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={(e) => { e.preventDefault(); setDragging(false) }}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const files = Array.from(e.dataTransfer.files ?? [])
        if (files.length === 0) return
        if (multiple && onFiles) onFiles(files)
        else onFile(files[0])
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed px-4 py-6 text-center transition-colors',
        dragging ? 'border-accent bg-accent/10' : 'border-border-2 bg-surface-1 hover:border-accent/50 hover:bg-surface-2',
      )}
    >
      <UploadCloud size={22} className={dragging ? 'text-accent-light' : 'text-text-3'} />
      <span className="text-xs font-semibold text-text-1">{label}</span>
      <span className="text-[10px] text-text-4">{detail}</span>
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length === 0) return
          if (multiple && onFiles) onFiles(files)
          else onFile(files[0])
          e.currentTarget.value = ''
        }}
      />
    </label>
  )
}
