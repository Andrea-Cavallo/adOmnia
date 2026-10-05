import { useEffect, type RefObject } from 'react'

let sequence = 0

/**
 * Sostituisce i blocchi ```mermaid dell'anteprima con il diagramma. mermaid si carica solo se
 * c'è almeno un blocco; securityLevel strict perché il Markdown può venire da chiunque.
 */
export function useMermaidBlocks(container: RefObject<HTMLElement | null>, html: string): void {
  useEffect(() => {
    const root = container.current
    const blocks = root ? [...root.querySelectorAll<HTMLElement>('[data-mermaid]')] : []
    if (!blocks.length) return
    let cancelled = false
    void import('mermaid').then(async ({ default: mermaid }) => {
      const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral' })
      for (const block of blocks) {
        if (cancelled) return
        const source = block.dataset.mermaid ?? ''
        try {
          const { svg } = await mermaid.render(`md-mermaid-${++sequence}`, source)
          if (cancelled || !block.isConnected) return
          block.innerHTML = svg
          block.classList.add('my-3', 'overflow-x-auto')
        } catch (error) {
          const note = document.createElement('p')
          note.className = 'mt-1 text-[10px] text-danger'
          note.textContent = `Mermaid: ${error instanceof Error ? error.message.split('\n')[0] : 'invalid diagram'}`
          block.appendChild(note)
        }
      }
    }).catch(() => { /* senza mermaid resta il codice */ })
    return () => { cancelled = true }
  }, [container, html])
}
