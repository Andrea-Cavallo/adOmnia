import { create } from 'zustand'

export interface Theme {
  id: string
  name: string
  author: string
  version: string
  description: string
  colors: Record<string, string>
  fonts: { sans: string; mono: string; serif: string }
  spacing: Record<string, string>
  radii: Record<string, string>
  shadows: Record<string, string>
  meta: Record<string, string>
  createdAt: string
  updatedAt: string
}

interface ThemesState {
  themes: Theme[]
  activeThemeId: string
  loading: boolean
  setThemes: (themes: Theme[]) => void
  setActiveThemeId: (id: string) => void
  setLoading: (v: boolean) => void
}

export const useThemesStore = create<ThemesState>((set) => ({
  themes: [],
  activeThemeId: '',
  loading: false,
  setThemes: (themes) => set({ themes }),
  setActiveThemeId: (id) => set({ activeThemeId: id }),
  setLoading: (v) => set({ loading: v }),
}))
