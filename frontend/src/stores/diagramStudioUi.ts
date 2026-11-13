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
  guides: Guide[]
  menu: ContextMenuState | null
  editNode: (id: string | null) => void
  editEdge: (id: string | null) => void
  toggleInspector: () => void
  setGuides: (guides: Guide[]) => void
  openMenu: (menu: ContextMenuState | null) => void
}

export const useDiagramUi = create<DiagramUiState>((set) => ({
  editingNodeId: null,
  editingEdgeId: null,
  inspectorOpen: true,
  guides: [],
  menu: null,
  editNode: (editingNodeId) => set({ editingNodeId, editingEdgeId: null }),
  editEdge: (editingEdgeId) => set({ editingEdgeId, editingNodeId: null }),
  toggleInspector: () => set((state) => ({ inspectorOpen: !state.inspectorOpen })),
  setGuides: (guides) => set((state) => (state.guides.length === 0 && guides.length === 0 ? state : { guides })),
  openMenu: (menu) => set({ menu }),
}))
