/**
 * Vecchia persistenza delle scorciatoie Code Studio (`adomnia.codestudio.keymap` in localStorage,
 * forma `{keymap, custom}`). Letta una sola volta dalla migrazione v15 delle impostazioni e
 * ancora scritta in doppio per il rollback: la fonte resta la sezione `keymap` delle impostazioni.
 */

export const LEGACY_KEYMAP_STORAGE_KEY = 'adomnia.codestudio.keymap'

export interface LegacyKeymapBinding {
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
  when?: string
}

export interface LegacyKeymapState {
  preset: 'goland' | 'vscode'
  bindings: Record<string, LegacyKeymapBinding | null>
}

/**
 * Converte il contenuto della vecchia chiave nel formato attuale. null se la chiave non c'è o
 * non è valida: nessuna scorciatoia viene inventata.
 */
export function legacyCodeStudioKeymap(raw: string | null): LegacyKeymapState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { keymap?: unknown; custom?: unknown }
    const preset: LegacyKeymapState['preset'] = parsed.keymap === 'vscode' ? 'vscode' : 'goland'
    const source = parsed.custom && typeof parsed.custom === 'object' && !Array.isArray(parsed.custom) ? parsed.custom as Record<string, unknown> : {}
    const bindings: LegacyKeymapState['bindings'] = {}
    for (const [id, value] of Object.entries(source)) {
      if (value === null) {
        bindings[id] = null
        continue
      }
      if (value && typeof value === 'object' && typeof (value as { key?: unknown }).key === 'string') {
        const binding = value as LegacyKeymapBinding
        bindings[id] = { key: binding.key, mod: binding.mod, shift: binding.shift, alt: binding.alt, when: binding.when }
      }
    }
    return { preset, bindings }
  } catch {
    return null
  }
}
