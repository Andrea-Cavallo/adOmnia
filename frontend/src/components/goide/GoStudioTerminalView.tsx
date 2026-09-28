import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { goStudioTerminalTheme } from './goStudioTerminalTheme'
import { closeGoIDETerminal, resizeGoIDETerminal, writeGoIDETerminal } from '@/lib/goide-api'
import { attachTerminal, forgetTerminal } from './goStudioTerminalBus'
import { useSettingsStore } from '@/stores/settings'

interface GoStudioTerminalViewProps {
  terminalId: string
  active: boolean
  onExit: (terminalId: string) => void
}

/**
 * Una istanza xterm collegata a un PTY reale. L'output arriva dagli eventi
 * backend e viene scritto direttamente nel terminale: non passa mai dallo stato
 * React, altrimenti un comando prolisso provocherebbe un re-render per blocco.
 */
export function GoStudioTerminalView({ terminalId, active, onExit }: GoStudioTerminalViewProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const theme = useSettingsStore((state) => (state.settings.appearance.theme === 'light' ? 'light' : 'dark'))

  useEffect(() => {
    if (!host.current) return
    const instance = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: terminalFontFamily(),
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: goStudioTerminalTheme(theme),
      allowProposedApi: true,
    })
    const fitAddon = new FitAddon()
    instance.loadAddon(fitAddon)
    instance.open(host.current)
    terminal.current = instance
    fit.current = fitAddon

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
      void writeGoIDETerminal(terminalId, data).catch((reason) => {
        instance.writeln(`\r\n\x1b[31m${String(reason)}\x1b[0m`)
      })
    })

    // La cronologia arriva dal bus e si riproduce solo quando la vista ha una misura reale,
    // così il testo non viene impaginato a due colonne mentre il pannello è nascosto.
    let unsubscribe: (() => void) | null = null
    const attachWhenMeasurable = () => {
      if (!sendResize() || unsubscribe) return
      unsubscribe = attachTerminal(terminalId, (data) => instance.write(data), () => {
        instance.writeln('\r\n\x1b[90m[process exited]\x1b[0m')
        onExit(terminalId)
      })
    }
    attachWhenMeasurable()

    const observer = new ResizeObserver(attachWhenMeasurable)
    observer.observe(host.current)

    return () => {
      observer.disconnect()
      unsubscribe?.()
      inputHandler.dispose()
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
