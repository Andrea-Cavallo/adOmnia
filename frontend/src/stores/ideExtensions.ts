import { create } from 'zustand'
import { IDEContributions } from '../../bindings/adomnia/goide'
import type { Contribution } from '../../bindings/adomnia/internal/plugins/models'
import type { GoIDEDiagnosticsReport } from '@/lib/goide-lsp-api'
export type IDEContribution = Contribution

export const useIDEExtensionsStore = create<{ items: Contribution[]; reports: Record<string,Record<string,GoIDEDiagnosticsReport>>; error: string | null; load: () => Promise<void> }>((set) => ({
 items: [], reports: {}, error: null,
 load: async () => { try { set({items: await IDEContributions(),error:null}) } catch (error) { set({items:[],error:String(error)}) } },
}))

export function extensionLanguageForPath(path: string, items = useIDEExtensionsStore.getState().items): Contribution | undefined {
 const name = path.replace(/\\/g,'/').split('/').pop()?.toLowerCase()
 if (name === 'go.mod' || name === 'go.work' || name?.endsWith('.go')) return undefined
 const extension = '.'+path.split('.').slice(-1)[0]?.toLowerCase()
 return items.find(item => item.kind === 'language' && item.extensions?.some(ext => ext.toLowerCase() === extension))
}
