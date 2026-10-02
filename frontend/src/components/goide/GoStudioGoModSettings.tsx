import { useEffect, useState } from 'react'
import { Ban, Check, FileDiff, Plus, Undo2 } from 'lucide-react'
import type { GoIDEDependencyActionRequest, GoIDEDependencyState } from '@/lib/goide-api'
import { GoStudioButton, GoStudioField } from './GoStudioModal'

/** Un'azione sul go.mod: comando mostrato nella conferma e richiesta strutturata per il backend. */
export interface GoModEdit {
  title: string
  command: string
  request: Pick<GoIDEDependencyActionRequest, 'action' | 'modulePath' | 'version'>
  danger?: boolean
}

interface GoStudioGoModSettingsProps {
  state: GoIDEDependencyState
  running: boolean
  onEdit: (edit: GoModEdit) => void
}

/**
 * Editor visuale delle direttive di go.mod che non sono dipendenze: go, toolchain, module,
 * exclude e retract. Ogni modifica passa da `go mod edit` dopo conferma, mai da una scrittura a mano.
 */
export function GoStudioGoModSettings({ state, running, onEdit }: GoStudioGoModSettingsProps) {
  const [goVersion, setGoVersion] = useState(state.goVersion ?? '')
  const [toolchain, setToolchain] = useState(state.toolchain ?? '')
  const [modulePath, setModulePath] = useState(state.modulePath)
  const [excludePath, setExcludePath] = useState('')
  const [excludeVersion, setExcludeVersion] = useState('')
  const [retract, setRetract] = useState('')
  useEffect(() => {
    setGoVersion(state.goVersion ?? '')
    setToolchain(state.toolchain ?? '')
    setModulePath(state.modulePath)
  }, [state.goVersion, state.toolchain, state.modulePath])

  const directive = (label: string, value: string, current: string, placeholder: string, setValue: (value: string) => void, edit: () => GoModEdit, hint?: string) => (
    <div className="flex items-end gap-2">
      <GoStudioField label={label} hint={hint} className="flex-1">
        <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && value.trim() && value.trim() !== current && !running) onEdit(edit()) }} placeholder={placeholder} className="gs-input gs-mono" />
      </GoStudioField>
      <GoStudioButton variant="secondary" icon={Check} disabled={running || !value.trim() || value.trim() === current} onClick={() => onEdit(edit())}>Apply</GoStudioButton>
    </div>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
      {directive('Module path', modulePath, state.modulePath, 'example.com/app', setModulePath, () => ({
        title: 'Rename module?', command: `go mod edit -module=${modulePath.trim()}`, request: { action: 'module', modulePath: modulePath.trim(), version: '' }, danger: true,
      }), 'Imports inside the module are not rewritten: use Rename on the package for that.')}
      <div className="grid grid-cols-2 gap-3">
        {directive('Go version', goVersion, state.goVersion ?? '', '1.24', setGoVersion, () => ({
          title: 'Change Go version?', command: `go mod edit -go=${goVersion.trim()}`, request: { action: 'goversion', modulePath: '', version: goVersion.trim() },
        }))}
        {directive('Toolchain', toolchain, state.toolchain ?? '', 'go1.24.3 or none', setToolchain, () => ({
          title: 'Change toolchain directive?', command: `go mod edit -toolchain=${toolchain.trim()}`, request: { action: 'toolchain', modulePath: '', version: toolchain.trim() },
        }))}
      </div>

      <section className="flex flex-col gap-1.5">
        <h3 className="gs-label">Exclude</h3>
        <div className="gs-list">
          {state.excludes.length === 0 && <div className="gs-list-empty">No excluded module versions.</div>}
          {state.excludes.map((exclude) => (
            <div key={`${exclude.path}@${exclude.version}`} className="gs-list-row">
              <span className="gs-mono min-w-0 flex-1 truncate text-text-1">{exclude.path} <span className="text-text-4">{exclude.version}</span></span>
              <GoStudioButton small variant="ghost" icon={Undo2} disabled={running} onClick={() => onEdit({ title: 'Remove exclude?', command: `go mod edit -dropexclude=${exclude.path}@${exclude.version}`, request: { action: 'dropexclude', modulePath: exclude.path, version: exclude.version } })}>Remove</GoStudioButton>
            </div>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <input value={excludePath} onChange={(event) => setExcludePath(event.target.value)} placeholder="example.com/lib" aria-label="Module to exclude" className="gs-input gs-mono flex-1" />
          <input value={excludeVersion} onChange={(event) => setExcludeVersion(event.target.value)} placeholder="v1.2.3" aria-label="Version to exclude" className="gs-input gs-mono w-32" />
          <GoStudioButton variant="secondary" icon={Ban} disabled={running || !excludePath.trim() || !excludeVersion.trim()} onClick={() => onEdit({ title: 'Exclude module version?', command: `go mod edit -exclude=${excludePath.trim()}@${excludeVersion.trim()}`, request: { action: 'exclude', modulePath: excludePath.trim(), version: excludeVersion.trim() } })}>Exclude</GoStudioButton>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <h3 className="gs-label">Retract <span className="font-normal text-text-4">— versions of this module that users should not pick</span></h3>
        <div className="gs-list">
          {state.retracts.length === 0 && <div className="gs-list-empty">No retracted versions.</div>}
          {state.retracts.map((item) => {
            const value = item.low === item.high ? item.low : `[${item.low},${item.high}]`
            return (
              <div key={value} className="gs-list-row">
                <div className="min-w-0 flex-1">
                  <div className="gs-mono truncate text-text-1">{value}</div>
                  {item.rationale && <div className="mt-0.5 truncate text-[11.5px] text-text-4">{item.rationale}</div>}
                </div>
                <GoStudioButton small variant="ghost" icon={Undo2} disabled={running} onClick={() => onEdit({ title: 'Remove retraction?', command: `go mod edit -dropretract=${value}`, request: { action: 'dropretract', modulePath: '', version: value } })}>Remove</GoStudioButton>
              </div>
            )
          })}
        </div>
        <div className="flex items-end gap-2">
          <input value={retract} onChange={(event) => setRetract(event.target.value)} placeholder="v1.0.1 or [v1.0.0,v1.0.5]" aria-label="Version to retract" className="gs-input gs-mono flex-1" />
          <GoStudioButton variant="secondary" icon={Plus} disabled={running || !retract.trim()} onClick={() => onEdit({ title: 'Retract version?', command: `go mod edit -retract=${retract.trim()}`, request: { action: 'retract', modulePath: '', version: retract.trim() } })}>Retract</GoStudioButton>
        </div>
      </section>

      <div className="flex items-center gap-2 border-t border-border-1 pt-3">
        <GoStudioButton variant="secondary" icon={FileDiff} disabled={running} onClick={() => onEdit({ title: 'Preview go mod tidy?', command: 'go mod tidy -diff', request: { action: 'tidydiff', modulePath: '', version: '' } })}>Preview tidy</GoStudioButton>
        <span className="gs-hint">Shows what go mod tidy would change in go.mod and go.sum without touching them (Go 1.23+).</span>
      </div>
    </div>
  )
}
