import { BrandIcon } from '@/components/ui/BrandIcon'
import { ideLanguage } from './languages'

/**
 * Logo Simple Icons di un linguaggio registrato, per i riepiloghi che ricevono solo l'ID dal
 * backend (per esempio le unità nella barra Run). Null quando il linguaggio non ha contribuzione.
 */
export function LanguageBrandIcon({ id, size = 13 }: { id: string; size?: number }) {
  const contribution = ideLanguage(id)
  return contribution ? <BrandIcon slug={contribution.icon} size={size} /> : null
}
