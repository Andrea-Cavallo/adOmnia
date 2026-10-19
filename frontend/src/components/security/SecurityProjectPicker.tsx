import { useEffect, useState } from 'react'
import { FolderOpen, History } from 'lucide-react'
import { listRecentGoIDEProjects, selectGoIDEFolder, type GoIDERecentProject } from '@/lib/code-studio-api'
import { cn } from '@/lib/utils'

interface SecurityProjectPickerProps {
  value: string
  onChange: (path: string) => void
  className?: string
  disabled?: boolean
}

/** Cartella del progetto da analizzare: scelta tra gli ultimi progetti aperti in Code Studio, selettore nativo o percorso incollato. */
export function SecurityProjectPicker({ value, onChange, className, disabled }: SecurityProjectPickerProps) {
  const [recents, setRecents] = useState<GoIDERecentProject[]>([])

  useEffect(() => {
    let current = true
    void listRecentGoIDEProjects().then((items) => {
      if (!current) return
      const available = items.filter((item) => item.available)
      setRecents(available)
      // Primo accesso: il progetto aperto più di recente è quello che di solito si vuole analizzare.
      if (available.length > 0 && !value) onChange(available[0].rootPath)
    }).catch(() => undefined)
    return () => { current = false }
    // Si propone il recente una volta sola, all'apertura.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const browse = async () => {
    try {
      const path = await selectGoIDEFolder('Select the project folder')
      if (path) onChange(path)
    } catch { /* selettore annullato */ }
  }

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <label className="sec-field min-w-0 flex-1">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Project folder"
          spellCheck={false}
          disabled={disabled}
          aria-label="Project folder"
          className="min-w-0 flex-1 font-mono"
        />
      </label>
      {recents.length > 0 && (
        <label className="sec-field" title="Recently opened projects">
          <History size={13} aria-hidden="true" />
          <select
            value=""
            disabled={disabled}
            aria-label="Recent projects"
            onChange={(event) => { if (event.target.value) onChange(event.target.value) }}
            className="w-24"
          >
            <option value="">Recent</option>
            {recents.map((item) => <option key={item.rootPath} value={item.rootPath}>{item.name} · {item.rootPath}</option>)}
          </select>
        </label>
      )}
      <button type="button" className="sec-btn" onClick={() => void browse()} disabled={disabled} title="Choose a folder">
        <FolderOpen size={13} aria-hidden="true" /> Browse
      </button>
    </div>
  )
}
