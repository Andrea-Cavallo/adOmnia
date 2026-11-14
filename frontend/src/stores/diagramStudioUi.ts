/**
 * What only the editor's chrome needs: which text is being edited, the inspector, the alignment
 * guides of the drag in progress and the context menu. Kept apart from the diagram store so none of
 * it reaches the saved file or the undo history.
 */
import { create } from 'zustand'
import type { Guide } from '@/lib/diagrams/guides'

export type ContextTarget = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | { kind: 'pane' }

export interface ContextMenuState {
  /** Screen position of the menu. */
  x: number
  y: number
  /** Flow position under the pointer, where Paste puts things. */
  flowX: number
  flowY: number
  target: ContextTarget
}

interface DiagramUiState {
  editingNodeId: string | null
  editingEdgeId: string | null
  inspectorOpen: boolean
  libraryOpen: boolean
  guides: Guide[]
  menu: ContextMenuState | null
  /** Node to bring into view and select (cross-panel navigation); cleared once framed. */
  focusNodeId: string | null
  editNode: (id: string | null) => void
  editEdge: (id: string | null) => void
  toggleInspector: () => void
  toggleLibrary: () => void
  setGuides: (guides: Guide[]) => void
  openMenu: (menu: ContextMenuState | null) => void
  focusNode: (id: string | null) => void
}

/** `focusNode(FIT_ALL)` frames the whole diagram, e.g. after nodes were added outside the view. */
export const FIT_ALL = '*'

export const useDiagramUi = create<DiagramUiState>((set) => ({
  editingNodeId: null,
  editingEdgeId: null,
  inspectorOpen: true,
  libraryOpen: true,
  guides: [],
  menu: null,
  focusNodeId: null,
  editNode: (editingNodeId) => set({ editingNodeId, editingEdgeId: null }),
  editEdge: (editingEdgeId) => set({ editingEdgeId, editingNodeId: null }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  toggleLibrary: () => set((state) => ({ libraryOpen: !state.libraryOpen })),
  setGuides: (guides) => set((state) => (state.guides.length === 0 && guides.length === 0 ? state : { guides })),
  openMenu: (menu) => set({ menu }),
  focusNode: (focusNodeId) => set({ focusNodeId }),
}))
