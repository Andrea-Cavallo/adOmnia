import { useState, type ElementType } from 'react'
import { ArrowRight, Search, Wrench } from 'lucide-react'
import { useAppStore, type RailItem } from '@/stores/app'
import { useNavigationTranslation, useUiTranslation, type UiMessage } from '@/lib/uiI18n'
import { HubMascot } from './HubMascot'
import goDark from './assets/hub/go-dark.webp'
import goLight from './assets/hub/go-light.webp'
import goSketch from './assets/hub/go-sketch.webp'
import apiDark from './assets/hub/api-dark.webp'
import apiLight from './assets/hub/api-light.webp'
import apiSketch from './assets/hub/api-sketch.webp'
import dataDark from './assets/hub/data-dark.webp'
import dataLight from './assets/hub/data-light.webp'
import dataSketch from './assets/hub/data-sketch.webp'
import docsDark from './assets/hub/docs-dark.webp'
import docsLight from './assets/hub/docs-light.webp'
import docsSketch from './assets/hub/docs-sketch.webp'
import gitDark from './assets/hub/git-dark.webp'
import gitLight from './assets/hub/git-light.webp'
import gitSketch from './assets/hub/git-sketch.webp'
import './WelcomePanel.css'

/**
 * The hub: headline + key art on top, five studio cards below. The same markup
 * serves every theme; WelcomePanel.css swaps the artwork (dark / light / sketch)
 * from the <html> class and data-skin, and dresses each variant.
 */

type HubCard = {
  pose: string
  title: string
  description: string
  target: RailItem
  art?: { dark: string; light: string; sketch: string }
  icon?: ElementType
}

type HubCardTarget = string | null

const HUB_CARDS: HubCard[] = [
  { pose: 'go', title: 'Go Studio', description: 'Build, debug and run Go services locally.', target: 'goide', art: { dark: goDark, light: goLight, sketch: goSketch } },
  { pose: 'api', title: 'API & Protocols', description: 'REST, SOAP, gRPC and more.', target: 'collections', art: { dark: apiDark, light: apiLight, sketch: apiSketch } },
  { pose: 'data', title: 'Data & Messaging', description: 'Databases, Kafka, MQTT, Streams.', target: 'database', art: { dark: dataDark, light: dataLight, sketch: dataSketch } },
  { pose: 'docs', title: 'Docs & Payloads', description: 'JSON, OpenAPI, examples and more.', target: 'jsonviewer', art: { dark: docsDark, light: docsLight, sketch: docsSketch } },
  { pose: 'git', title: 'Version Control', description: 'Repositories, branches and diffs.', target: 'gitsync', art: { dark: gitDark, light: gitLight, sketch: gitSketch } },
  { pose: 'tools', title: 'Power Tools', description: 'Encode, decode, inspect and automate.', target: 'powertools', icon: Wrench },
]

export function WelcomePanel() {
  const tr = useUiTranslation()
  const setActiveRail = useAppStore((s) => s.setActiveRail)
  const [hoveredCard, setHoveredCard] = useState<HubCardTarget>(null)
  const [focusedCard, setFocusedCard] = useState<HubCardTarget>(null)
  const activeCard = hoveredCard ?? focusedCard

  return (
    <div className="relative min-h-full overflow-auto text-text-1" data-hub-page>
      <div className="relative mx-auto flex min-h-full max-w-[1600px] flex-col px-10 py-6 max-lg:px-5">
        <header data-hub-hero className="relative grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] items-center max-xl:grid-cols-1">
          <div className="relative z-10 min-w-0 py-4">
            <h1 data-hub-headline className="m-0">
              <span data-hub-headline-lead>{tr('Call it. Code it.')}</span>
              <br />
              <span data-hub-headline-go>{tr('Ship it.')}</span>
            </h1>
            <p data-hub-lede className="mb-0 mt-4 text-text-2">
              {tr('Everything you need for modern development.' as UiMessage)}
              <br />
              {tr('Local-first. Flexible. Powerful.' as UiMessage)}
            </p>

            <button
              type="button"
              data-hub-search
              onClick={() => document.dispatchEvent(new CustomEvent('adomnia:open-palette'))}
            >
              <Search size={18} className="shrink-0 text-text-2" />
              <span className="min-w-0 flex-1 truncate text-text-3">{tr('Search tools, requests, docs, code...' as UiMessage)}</span>
              <kbd>Ctrl/Cmd + K</kbd>
            </button>
          </div>

          <div data-hub-art-slot className="max-xl:hidden">
            <HubMascot />
          </div>
        </header>

        <div data-hub-card-grid className="relative z-10 mt-2 grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
          {HUB_CARDS.map((card) => (
            <HubCardView
              key={card.pose}
              card={card}
              onOpen={setActiveRail}
              active={activeCard === card.pose}
              onHover={setHoveredCard}
              onFocus={setFocusedCard}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function HubCardView({ card, onOpen, active, onHover, onFocus }: {
  card: HubCard
  onOpen: (id: RailItem) => void
  active: boolean
  onHover: (target: HubCardTarget) => void
  onFocus: (target: HubCardTarget) => void
}) {
  const nav = useNavigationTranslation()
  const tr = useUiTranslation()
  const CardIcon = card.icon

  return (
    <article
      data-hub-card
      data-hub-card-kind={card.pose}
      data-hub-card-active={active ? 'true' : undefined}
      data-hub-card-featured={card.pose === 'go' ? 'true' : undefined}
      onPointerEnter={() => onHover(card.pose)}
      onPointerLeave={() => onHover(null)}
      onFocusCapture={() => onFocus(card.pose)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onFocus(null)
      }}
    >
      <button type="button" data-hub-card-button onClick={() => onOpen(card.target)}>
        <span data-hub-card-icon aria-hidden>
          {card.art && <>
            <img src={card.art.dark} alt="" draggable={false} data-hub-art="dark" />
            <img src={card.art.light} alt="" draggable={false} data-hub-art="light" />
            <img src={card.art.sketch} alt="" draggable={false} data-hub-art="sketch" />
          </>}
          {CardIcon && <span data-hub-card-generated-icon><CardIcon strokeWidth={1.45} /></span>}
        </span>
        <span data-hub-card-title>{nav(card.title)}</span>
        <span data-hub-card-desc>{tr(card.description as UiMessage)}</span>
        <span data-hub-card-arrow aria-hidden><ArrowRight size={20} /></span>
      </button>
    </article>
  )
}
