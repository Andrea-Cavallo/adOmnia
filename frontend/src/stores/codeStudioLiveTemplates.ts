import { create } from 'zustand'
import { parseUserTemplates, type LiveTemplate } from '@/lib/code-studio/liveTemplates'

const KEY = 'adomnia.codestudio.liveTemplates.v1'
function load(): LiveTemplate[] {
  try { return parseUserTemplates(localStorage.getItem(KEY) ?? '[]') } catch { return [] }
}

interface LiveTemplateState {
  templates: LiveTemplate[]
  replace: (raw: string) => void
}

export const useLiveTemplates = create<LiveTemplateState>((set, get) => ({
  templates: load(),
  replace: (raw) => {
    if (raw.length > 1024 * 1024) throw new Error('Template import exceeds 1 MiB.')
    const imported = parseUserTemplates(raw)
    const merged = new Map(get().templates.map(template => [template.id, template]))
    for (const template of imported) merged.set(template.id, template)
    const templates = parseUserTemplates(JSON.stringify([...merged.values()]))
    localStorage.setItem(KEY, JSON.stringify(templates))
    set({ templates })
  },
}))
