import { Folder, FolderOpen } from 'lucide-react'

/** Shared folder silhouette; the explorer supplies its own theme-aware tone. */
export function CodeStudioFolderIcon({ open = false, size = 16 }: { open?: boolean; size?: number }) {
  const Icon = open ? FolderOpen : Folder
  return <Icon size={size} strokeWidth={1.5} fill="currentColor" fillOpacity={open ? 0.12 : 0.06} aria-hidden="true" className={`code-studio-folder-icon shrink-0 ${open ? 'text-text-2' : 'text-text-3'}`} />
}
