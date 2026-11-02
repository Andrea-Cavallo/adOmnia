import { useState } from 'react'
import { Download } from 'lucide-react'
import { ContextMenu } from '@/components/ui/ContextMenu'
import { saveTextFile } from '@/lib/fileUtils'
import { openEntity } from '@/lib/entities/router'
import { showEntityNotice } from '@/lib/entities/notice'
import type { GoIDEExecution } from '@/lib/code-studio-api'
import type { ConsoleChunk } from './codeStudioConsoleLines'
import { createRunLogSnapshot } from './codeStudioRunLogExport'

export function CodeStudioRunLogActions({ execution, chunks }: { execution: GoIDEExecution | undefined | null; chunks: readonly ConsoleChunk[] }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const select = async (format: string) => {
    setMenu(null)
    if (!execution || busy) return
    const snapshot = createRunLogSnapshot(execution, chunks)
    setBusy(true)
    try {
      if (format === 'inspector') {
        await openEntity({ kind: 'artifact', id: execution.id, label: `${snapshot.name}.jsonl`, attrs: { type: 'run-log', text: snapshot.inspector } }, 'inspect-run-logs')
      } else {
        await saveTextFile(`${snapshot.name}.${format}`, format === 'json' ? snapshot.json : snapshot.txt, format === 'json' ? 'application/json' : 'text/plain')
      }
    } catch (error) {
      showEntityNotice(`Could not export logs: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setBusy(false)
    }
  }
  return <>
    <button type="button" disabled={!execution || !chunks.length || busy} aria-label="Export logs" aria-haspopup="menu" aria-expanded={!!menu} title="Export logs or open in Log Inspector" className="code-studio-icon-button h-7 w-7" onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect()
      setMenu({ x: rect.right, y: rect.top })
    }}><Download size={13} /></button>
    {menu && <ContextMenu {...menu} appearance="studio" compact items={[
      { id: 'json', label: 'Export logs as JSON' },
      { id: 'txt', label: 'Export logs as TXT' },
      { id: 'inspector', label: 'Open in Log Inspector', separatorBefore: true },
    ]} onSelect={id => void select(id)} onClose={() => setMenu(null)} />}
  </>
}
