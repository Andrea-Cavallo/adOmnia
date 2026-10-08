import { useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useUiTranslation } from '@/lib/uiI18n'

const messages = {
  'Your adOmnia': 'Il tuo adOmnia',
  'Choose your colors. Preview first, then apply or save a profile.':
    'Scegli i tuoi colori. Guarda l’anteprima, poi applica o salva un profilo.',
  'Style applied': 'Stile applicato',
  'Profile limit reached': 'Hai raggiunto il limite di 50 profili',
  'Black / White': 'Nero / Bianco',
  'White / Black': 'Bianco / Nero',
  'Use theme colors': 'Usa i colori del tema',
  'Primary color': 'Colore primario',
  'Base color': 'Colore di base',
  'Primary color HEX': 'Colore primario HEX',
  'Base color HEX': 'Colore di base HEX',
  'Style preview': 'Anteprima dello stile',
  'Your workspace, your style': 'Il tuo spazio, il tuo stile',
  'Readable shades are derived automatically. Status colors keep their meaning.':
    'Le tonalità leggibili vengono generate automaticamente. I colori di stato mantengono il loro significato.',
  'Enter a six-digit HEX color, for example #FACC15.':
    'Inserisci un colore HEX a sei cifre, ad esempio #FACC15.',
  'Stop live preview': 'Ferma anteprima',
  'Preview in app': 'Anteprima nell’app',
  'Apply style': 'Applica stile',
  'Saved profiles': 'Profili salvati',
  'Save a name for this look and switch back to it whenever you want.':
    'Dai un nome a questo stile e ritrovalo quando vuoi.',
  'The theme for this profile is unavailable.':
    'Il tema di questo profilo non è disponibile.',
  'Delete profile': 'Elimina profilo',
  'Profile name': 'Nome del profilo',
  'Update profile': 'Aggiorna profilo',
  'Save profile': 'Salva profilo',
  'Save as new': 'Salva come nuovo',
} as const

export function usePersonalAppearanceTranslation() {
  const language = useSettingsStore((s) => s.settings.appearance.language)
  const translate = useUiTranslation()
  return useCallback(
    (key: keyof typeof messages | 'Send' | 'Cancel' | 'Delete') => {
      if (key === 'Send' || key === 'Cancel' || key === 'Delete')
        return translate(key)
      return language === 'it' ? messages[key] : key
    },
    [language, translate],
  )
}
