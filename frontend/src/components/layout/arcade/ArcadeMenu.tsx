import { useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import type { GameId } from './types'
import { GAME_IDS, GAME_TITLES } from './gameCatalog'

export function ArcadeMenu({ onSelect, onClose }: { onSelect: (id: GameId) => void; onClose: () => void }) {
  const t = useUiTranslation()
  return <section className="hub-arcade-menu" aria-label={t('Arcade')} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}>
    <header><strong>{t('Arcade')} / 06</strong><button type="button" onClick={onClose} aria-label={t('Close arcade menu')}>×</button></header>
    <p>{t('Choose your game')}</p>
    <div>{GAME_IDS.map((id, i) => <button type="button" key={id} onClick={() => onSelect(id)}><small>{String(i + 1).padStart(2, '0')}</small><span>{t(GAME_TITLES[id] as UiMessage)}</span><b aria-hidden="true">↗</b></button>)}</div>
  </section>
}

