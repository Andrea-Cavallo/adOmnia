import { Folder, FolderOpen } from 'lucide-react'

/** Cartella a linea, neutra come nel resto di adOmnia (sidebar delle collection): il colore resta ai file e agli stati. */
export function CodeStudioFolderIcon({ open = false, size = 14 }: { open?: boolean; size?: number }) {
  const Icon = open ? FolderOpen : Folder
  return <Icon size={size} aria-hidden="true" className={`shrink-0 ${open ? 'text-text-2' : 'text-text-3'}`} />
}
