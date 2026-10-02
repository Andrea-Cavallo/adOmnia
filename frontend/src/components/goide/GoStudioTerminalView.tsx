import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { goStudioTerminalTheme } from './goStudioTerminalTheme'
import { closeGoIDETerminal, resizeGoIDETerminal, writeGoIDETerminal } from '@/lib/goide-api'
import { attachTerminal, forgetTerminal } from './goStudioTerminalBus'
import { TerminalLineTracker, cleanBufferText, findTerminalLinks, type GoStudioTerminalLink } from './goStudioTerminalLinks'
import { useSettingsStore } from '@/stores/settings'

interface GoStudioTerminalViewProps {
  terminalId: string
  active: boolean
  onExit: (terminalId: string) => void
  /** Click su "file.go:12" o su un frame di stack trace. */
  onOpenLink: (terminalId: string, link: GoStudioTerminalLink) => void
  /** Riga digitata e confermata con Invio (cronologia e rilevamento dei comandi go). */
  onCommand: (terminalId: string, command: string) => void
  /** Ctrl+F dentro il terminale. */
  onFind: () => void
  onFocus: (terminalId: string) => void
}

/** Istanze montate, per le azioni del toolbar (ricerca, copia, cronologia) sul terminale a fuoco. */
export interface GoStudioTerminalHandle {
  search: SearchAddon
  cleanText: () => string
  paste: (text: string) => void
  clear: () => void
  focus: () => void
}

const handles = new Map<string, GoStudioTerminalHandle>()

export function terminalHandle(terminalId: string | null): GoStudioTerminalHandle | undefined {
  return terminalId ? handles.get(terminalId) : undefined
}

/**
 * Una istanza xterm collegata a un PTY reale. L'output arriva dagli eventi
 * backend e viene scritto direttamente nel terminale: non passa mai dallo stato
 * React, altrimenti un comando prolisso provocherebbe un re-render per blocco.
 */
export function GoStudioTerminalView({ terminalId, active, onExit, onOpenLink, onCommand, onFind, onFocus }: GoStudioTerminalViewProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const theme = useSettingsStore((state) => (state.settings.appearance.theme === 'light' ? 'light' : 'dark'))
  // I callback cambiano a ogni render del pannello: il terminale legge sempre l'ultima versione.
  const callbacks = useRef({ onExit, onOpenLink, onCommand, onFind, onFocus })
  callbacks.current = { onExit, onOpenLink, onCommand, onFind, onFocus }

  useEffect(() => {
    if (!host.current) return
    const instance = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: terminalFontFamily(),
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 5000,
      theme: goStudioTerminalTheme(theme),
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    instance.loadAddon(fitAddon)
    instance.loadAddon(searchAddon)
    instance.open(host.current)
    terminal.current = instance
    fit.current = fitAddon

    // ponytail: i link si cercano riga per riga; un percorso spezzato dal wrap non è cliccabile.
    const links = instance.registerLinkProvider({
      provideLinks(row, callback) {
        const text = instance.buffer.active.getLine(row - 1)?.translateToString(true) ?? ''
        callback(findTerminalLinks(text).map((link) => ({
          range: { start: { x: link.start + 1, y: row }, end: { x: link.end, y: row } },
          text: text.slice(link.start, link.end),
          decorations: { pointerCursor: true, underline: true },
          activate: (event) => {
            // Come negli IDE: il click semplice resta selezione, Ctrl/Cmd+click apre il file.
            if (event.ctrlKey || event.metaKey) callbacks.current.onOpenLink(terminalId, link)
          },
        })))
      },
    })

    instance.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
        callbacks.current.onFind()
        return false
      }
      return true
    })

    const lines = new TerminalLineTracker()
    const handle: GoStudioTerminalHandle = {
      search: searchAddon,
      cleanText: () => {
        const buffer = instance.buffer.active
        const rows = []
        for (let index = 0; index < buffer.length; index++) {
          const line = buffer.getLine(index)
          if (line) rows.push({ text: line.translateToString(true), wrapped: line.isWrapped })
        }
        return cleanBufferText(rows)
      },
      // Il testo si inserisce senza Invio: l'utente rilegge il comando prima di eseguirlo.
      paste: (text) => { instance.paste(text); instance.focus() },
      clear: () => instance.clear(),
      focus: () => instance.focus(),
    }
    handles.set(terminalId, handle)

    // Un pannello nascosto misura 0×0: adattarsi a quella misura restringerebbe la shell a poche colonne.
    const measurable = () => !!host.current && host.current.clientWidth > 0 && host.current.clientHeight > 0
    const sendResize = () => {
      if (!measurable()) return false
      try {
        fitAddon.fit()
      } catch {
        return false
      }
      void resizeGoIDETerminal(terminalId, instance.cols, instance.rows).catch(() => undefined)
      // Tornando visibile con le stesse dimensioni xterm non ridisegna da solo.
      instance.refresh(0, instance.rows - 1)
      return true
    }

    const inputHandler = instance.onData((data) => {
      for (const command of lines.push(data)) callbacks.current.onCommand(terminalId, command)
      void writeGoIDETerminal(terminalId, data).catch((reason) => {
        instance.writeln(`\r\n\x1b[31m${String(reason)}\x1b[0m`)
      })
    })
    const focusHandler = instance.textarea
    const onTextareaFocus = () => callbacks.current.onFocus(terminalId)
    focusHandler?.addEventListener('focus', onTextareaFocus)

    // La cronologia arriva dal bus e si riproduce solo quando la vista ha una misura reale,
    // così il testo non viene impaginato a due colonne mentre il pannello è nascosto.
    let unsubscribe: (() => void) | null = null
    const attachWhenMeasurable = () => {
      if (!sendResize() || unsubscribe) return
      unsubscribe = attachTerminal(terminalId, (data) => instance.write(data), () => {
        instance.writeln('\r\n\x1b[90m[process exited]\x1b[0m')
        callbacks.current.onExit(terminalId)
      })
    }
    attachWhenMeasurable()

    const observer = new ResizeObserver(attachWhenMeasurable)
    observer.observe(host.current)

    // xterm misura le celle sul canvas all'avvio: se il font mono arriva dopo, si rimisura con il glifo giusto.
    let disposed = false
    void document.fonts.load(`13px ${terminalFontFamily()}`).then(() => {
      if (disposed) return
      instance.options.fontFamily = terminalFontFamily()
      sendResize()
    }).catch(() => undefined)

    return () => {
      disposed = true
      observer.disconnect()
      unsubscribe?.()
      inputHandler.dispose()
      links.dispose()
      focusHandler?.removeEventListener('focus', onTextareaFocus)
      if (handles.get(terminalId) === handle) handles.delete(terminalId)
      // xterm accoda in open() un timer sul viewport: smontare nello stesso tick lo farebbe girare su un'istanza già distrutta.
      setTimeout(() => instance.dispose(), 0)
      terminal.current = null
      fit.current = null
    }
    // terminalId identifica univocamente il PTY: cambiarlo significa un altro terminale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId])

  useEffect(() => {
    if (terminal.current) terminal.current.options.theme = goStudioTerminalTheme(theme)
  }, [theme])

  useEffect(() => {
    if (!active || !terminal.current || !fit.current) return
    // Il pannello nascosto ha dimensioni nulle: si rimisura solo quando è visibile (poi ci pensa il ResizeObserver).
    if (!host.current || host.current.clientWidth === 0) return
    try {
      fit.current.fit()
      void resizeGoIDETerminal(terminalId, terminal.current.cols, terminal.current.rows).catch(() => undefined)
    } catch {
      /* il contenitore non è ancora misurabile */
    }
    terminal.current.focus()
  }, [active, terminalId])

  return <div ref={host} className="h-full w-full" data-terminal-id={terminalId} />
}

/** closeTerminal è esposto per la chiusura esplicita dalla barra dei tab. */
export async function closeTerminal(terminalId: string): Promise<void> {
  await closeGoIDETerminal(terminalId)
  forgetTerminal(terminalId)
}

const FALLBACK_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

/** xterm misura i glifi su canvas, che non risolve le variabili CSS: serve il valore reale del token. */
function terminalFontFamily(): string {
  const root = getComputedStyle(document.documentElement)
  const token = root.getPropertyValue('--skin-font-mono').trim() || root.getPropertyValue('--font-mono').trim()
  return token ? `${token}, ${FALLBACK_MONO}` : FALLBACK_MONO
}
