import { create } from 'zustand'

/** Riga dell'elenco: il file e dove si trova dentro il modulo. */
export interface GoIDEFilePickItem {
  id: string
  name: string
  detail: string
}

export interface GoIDEFilePickOptions {
  title: string
  /** Testo fisso prima del campo di ricerca, es. il modulo e la sua versione. */
  prefix?: string
  items: GoIDEFilePickItem[]
}

interface GoIDEFilePickState {
  open: boolean
  title: string
  prefix: string
  items: GoIDEFilePickItem[]
  resolve: ((id: string | null) => void) | null
  request: (options: GoIDEFilePickOptions) => Promise<string | null>
  settle: (id: string | null) => void
}

/**
 * App-native, promise-based file picker. Serve a scegliere un file dentro un elenco già noto
 * (per esempio i sorgenti di una dipendenza) senza lasciare l'editor.
 *
 * Usage:
 *   const file = await pickGoIDEFile({ title: 'Files of x', items })
 */
export const useGoIDEFilePickStore = create<GoIDEFilePickState>((set, get) => ({
  open: false,
  title: '',
  prefix: '',
  items: [],
  resolve: null,
  request: (options) =>
    new Promise<string | null>((resolve) => {
      const previous = get().resolve
      if (previous) previous(null)
      set({ open: true, title: options.title, prefix: options.prefix ?? '', items: options.items, resolve })
    }),
  settle: (id) => {
    const resolve = get().resolve
    set({ open: false, resolve: null })
    if (resolve) resolve(id)
  },
}))

export function pickGoIDEFile(options: GoIDEFilePickOptions): Promise<string | null> {
  return useGoIDEFilePickStore.getState().request(options)
}

/** Ogni termine della ricerca deve comparire nel nome o nel percorso del file. */
export function filterFilePickItems(items: GoIDEFilePickItem[], query: string): GoIDEFilePickItem[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return items
  return items.filter((item) => {
    const haystack = `${item.name} ${item.detail}`.toLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
