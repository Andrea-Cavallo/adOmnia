import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { goStudioTerminalTheme } from './goStudioTerminalTheme'
import {
  closeGoIDETerminal,
  resizeGoIDETerminal,
  subscribeGoIDEEvents,
  writeGoIDETerminal,
  type GoIDETerminalOutput,
} from '@/lib/goide-api'
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
      fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
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

    const sendResize = () => {
      try {
        fitAddon.fit()
      } catch {
        return
      }
      void resizeGoIDETerminal(terminalId, instance.cols, instance.rows).catch(() => undefined)
    }
    sendResize()

    const inputHandler = instance.onData((data) => {
      void writeGoIDETerminal(terminalId, data).catch((reason) => {
        instance.writeln(`\r\n\x1b[31m${String(reason)}\x1b[0m`)
      })
    })

    const unsubscribe = subscribeGoIDEEvents((event) => {
      if (event.resourceId !== terminalId) return
      if (event.type === 'terminal.output') {
        const payload = event.payload as GoIDETerminalOutput | undefined
        if (!payload?.data) return
        if (payload.truncated) instance.write('\r\n\x1b[90m… output troncato per mantenere reattiva l\'interfaccia\x1b[0m\r\n')
        instance.write(payload.data)
        return
      }
      if (event.type === 'terminal.exited') {
        instance.writeln('\r\n\x1b[90m[processo terminato]\x1b[0m')
        onExit(terminalId)
      }
    })

    const observer = new ResizeObserver(sendResize)
    observer.observe(host.current)

    return () => {
      observer.disconnect()
      unsubscribe()
      inputHandler.dispose()
      instance.dispose()
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
    // Il pannello nascosto ha dimensioni nulle: al ritorno va rimisurato.
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
}
