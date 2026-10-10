import { useEntityHandoff } from '@/lib/entities/dispatch'
import { useGoIDEStore } from '@/stores/goide'
import { useGoStudioAssistantStore } from '@/stores/goStudioAssistant'
import { useGoStudioRuntimeContext } from '@/stores/goStudioRuntimeContext'
import { openSpanSource } from '@/components/observe/openSpanSource'
import { spanSource } from '@/components/observe/traceStudioModel'
import type { OtlpSpan } from '@/lib/otlp-api'

export function useGoStudioRuntimeContextHandoff(): void {
  useEntityHandoff('goide', (ref, intent) => {
    if (intent !== 'runtime') return false
    const store = useGoIDEStore.getState()
    if (!store.initialized) return false
    void (async () => {
      try {
        if (!ref.attrs.runtimeSpan || ref.attrs.runtimeSpan.length > 65536) throw new Error('Invalid runtime context')
        const span = JSON.parse(ref.attrs.runtimeSpan) as OtlpSpan
        if (!span || typeof span.traceId !== 'string' || typeof span.service !== 'string' || !Number.isFinite(span.durationMs)) throw new Error('Invalid runtime context')
        const source = spanSource(span)
        if (!source || !Number.isInteger(source.line) || source.line < 1) throw new Error('This span has no source location')
        await openSpanSource(source.file, source.line)
        const current = useGoIDEStore.getState()
        if (!current.activeSessionId) throw new Error('Open the service project to inspect this runtime context')
        useGoStudioRuntimeContext.setState({ selected: { sessionId: current.activeSessionId, span } })
        useGoStudioAssistantStore.getState().close()
        current.updateLayout({ structureOpen: true })
      } catch (error) { useGoIDEStore.setState({ error: error instanceof Error ? error.message : String(error) }) }
    })()
  })
}
