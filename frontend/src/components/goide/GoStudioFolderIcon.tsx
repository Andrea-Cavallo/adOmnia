/**
 * Cartella in stile Finder (macOS): retro con linguetta, fronte più chiaro, filo di luce in alto.
 * Solo colori pieni dai token CSS (niente gradienti con id): centinaia di righe dell'albero restano leggere.
 */
const CLOSED_FRONT = 'M1.5 6.2A1.2 1.2 0 0 1 2.7 5h10.6a1.2 1.2 0 0 1 1.2 1.2v6.1a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2Z'
const OPEN_FRONT = 'M3.1 7.2A1.2 1.2 0 0 1 4.2 6.4h10.1a.9.9 0 0 1 .86 1.15l-1.3 5.1a1.2 1.2 0 0 1-1.16.85H2.6a.9.9 0 0 1-.87-1.12Z'
const BACK = 'M1.5 3.7A1.2 1.2 0 0 1 2.7 2.5h3.1a1.2 1.2 0 0 1 .85.35l.95.95h5.7a1.2 1.2 0 0 1 1.2 1.2v7.3a1.2 1.2 0 0 1-1.2 1.2H2.7a1.2 1.2 0 0 1-1.2-1.2Z'

export function GoStudioFolderIcon({ open = false, size = 15 }: { open?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="go-studio-folder-icon shrink-0">
      <path d={BACK} className="go-studio-folder-back" />
      <path d={open ? OPEN_FRONT : CLOSED_FRONT} className="go-studio-folder-front" />
      {!open && <path d="M2.4 5.55h11.2" className="go-studio-folder-shine" />}
    </svg>
  )
}
