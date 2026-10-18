import type { GoIDERunConfiguration } from '@/lib/code-studio-api'
import { emptyRunConfiguration, templateKey } from '@/lib/code-studio/runFormTypes'
import { runTemplates } from '@/lib/code-studio/runFormSchema'
import { CodeStudioRunSuggestions } from './CodeStudioRunSuggestions'
interface Props {
  sessionId: string; busy: boolean
  onChoose: (draft: GoIDERunConfiguration) => void
  onCreate: (draft: GoIDERunConfiguration) => Promise<void>
}
export function CodeStudioRunWizard({ sessionId, busy, onChoose, onCreate }: Props) {
  return <div className="min-h-0 flex-1 overflow-auto p-5">
    <h2 className="text-[15px] font-semibold text-text-1">New configuration</h2>
    <p className="gs-hint mt-1 mb-4">Start with a detected entry, or choose a provider to configure it yourself.</p>
    <CodeStudioRunSuggestions sessionId={sessionId} savedCount={0} onAdd={suggested => onCreate({ ...emptyRunConfiguration(sessionId), ...suggested, sessionId })} />
    {Array.from(new Set(runTemplates.map(item => item.group))).map(group => <section key={group} className="mt-4">
      <h3 className="gs-section-title mb-2">{group}</h3><div className="grid grid-cols-2 gap-2">
        {group === 'Generic' && <button type="button" disabled={busy} className="gs-btn gs-btn-secondary justify-start" onClick={() => {
          const windows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform)
          onChoose({ ...emptyRunConfiguration(sessionId), name: 'Shell command', target: windows ? 'powershell.exe' : 'sh', programArguments: windows ? ['-NoProfile', '-Command', 'Write-Output "Hello"'] : ['-c', 'echo "Hello"'] })
        }}>Shell command</button>}
        {runTemplates.filter(item => item.group === group).map(item => <button type="button" key={templateKey(item)} disabled={busy} className="gs-btn gs-btn-secondary justify-start" onClick={() => onChoose({ ...emptyRunConfiguration(sessionId), language: item.language, kind: item.kind as GoIDERunConfiguration['kind'], target: item.target ?? '', name: `${item.group} · ${item.label}`, languageOptions: {} })}>{item.label}</button>)}
      </div>
    </section>)}
    <p className="gs-hint mt-4">Commands run directly as executables. For shell syntax, choose your shell as the executable and pass the script as arguments.</p>
  </div>
}
