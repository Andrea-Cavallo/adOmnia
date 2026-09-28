import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Loader2, Save, ShieldAlert, X } from 'lucide-react'
import { chooseGoIDEProjectParent } from '@/lib/goide-api'
import { useModalFocusTrap } from '@/lib/accessibility'
import { useGoIDEStore, type GoIDEEditorDocument } from '@/stores/goide'

export interface GoStudioRunDraft {
  target: string
  workingDirectory: string
  goArguments: string
  programArguments: string
  buildTags: string
  environment: string
}

interface CreateProjectDialogProps {
  open: boolean
  onClose: () => void
}

export function CreateProjectDialog({ open, onClose }: CreateProjectDialogProps) {
  const [parentPath, setParentPath] = useState('')
  const [name, setName] = useState('')
  const [modulePath, setModulePath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const createProject = useGoIDEStore((state) => state.createProject)
  useModalFocusTrap(open, onClose, dialogRef)

  useEffect(() => {
    if (!open) return
    setParentPath('')
    setName('')
    setModulePath('')
  }, [open])

  if (!open) return null

  const chooseParent = async () => {
    const path = await chooseGoIDEProjectParent()
    if (path) setParentPath(path)
  }
  const submit = async () => {
    setSubmitting(true)
    const created = await createProject(parentPath, name, modulePath)
    setSubmitting(false)
    if (created) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Create Go project" tabIndex={-1} className="w-[460px] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center border-b border-border-1 px-4"><h2 className="text-xs font-semibold text-text-1">Create Go project</h2><button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <div className="space-y-3 p-4">
          <label className="block text-[10px] font-medium text-text-3">Parent folder</label>
          <div className="flex gap-2"><input readOnly value={parentPath} placeholder="Choose a local folder" className="h-8 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 text-[11px] text-text-2" /><button type="button" onClick={() => void chooseParent()} className="flex h-8 items-center gap-1.5 rounded border border-border-1 px-2 text-[11px] text-text-2 hover:border-accent"><FolderOpen size={12} /> Choose…</button></div>
          <label className="block text-[10px] font-medium text-text-3">Project name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="hello-service" className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent" /></label>
          <label className="block text-[10px] font-medium text-text-3">Module path<input value={modulePath} onChange={(event) => setModulePath(event.target.value)} placeholder="example.com/hello-service" className="mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" /></label>
          <div className="rounded border border-warning/25 bg-warning/5 p-2.5 text-[10px] leading-4 text-text-3"><div className="mb-1 flex items-center gap-1.5 font-semibold text-warning"><ShieldAlert size={12} /> Explicit tool action</div>Creating runs <code className="font-mono text-text-1">go mod init {modulePath || '<module-path>'}</code> inside the new empty folder. It does not download dependencies or run project code.</div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3"><button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button><button type="button" disabled={!parentPath || !name || !modulePath || submitting} onClick={() => void submit()} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{submitting && <Loader2 size={11} className="animate-spin" />} Create & initialize</button></div>
      </div>
    </div>
  )
}

interface UnsavedDialogProps {
  open: boolean
  documents: GoIDEEditorDocument[]
  onSave: () => Promise<void>
  onDiscard: () => Promise<void> | void
  onCancel: () => void
}

export function UnsavedChangesDialog({ open, documents, onSave, onDiscard, onCancel }: UnsavedDialogProps) {
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onCancel, dialogRef)
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={onCancel}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Unsaved changes" tabIndex={-1} className="w-[420px] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="p-5"><div className="mb-3 grid h-9 w-9 place-items-center rounded-full bg-warning/10 text-warning"><Save size={16} /></div><h2 className="text-[13px] font-semibold text-text-1">Save changes before closing?</h2><p className="mt-1 text-[11px] leading-4 text-text-3">Your editor buffers are still available. Choose Save, Discard, or return to the editor.</p><div className="mt-3 max-h-28 overflow-auto rounded border border-border-1 bg-surface-0 p-2 font-mono text-[10px] text-text-3">{documents.map((document) => <div key={document.document.id} className="truncate">{document.document.relativePath}</div>)}</div></div>
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3"><button type="button" onClick={onCancel} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button><button type="button" onClick={() => void onDiscard()} className="h-7 rounded px-3 text-xs text-warning hover:bg-warning/10">Discard</button><button type="button" disabled={saving} onClick={() => { setSaving(true); void onSave().finally(() => setSaving(false)) }} className="flex h-7 items-center gap-1.5 rounded bg-accent px-3 text-xs font-semibold text-white disabled:opacity-40">{saving && <Loader2 size={11} className="animate-spin" />} Save</button></div>
      </div>
    </div>
  )
}

interface RunConfigurationDialogProps {
  open: boolean
  draft: GoStudioRunDraft
  onSave: (draft: GoStudioRunDraft) => void
  onClose: () => void
}

export function RunConfigurationDialog({ open, draft, onSave, onClose }: RunConfigurationDialogProps) {
  const [value, setValue] = useState(draft)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalFocusTrap(open, onClose, dialogRef)
  useEffect(() => { if (open) setValue(draft) }, [draft, open])
  if (!open) return null
  const field = (key: keyof GoStudioRunDraft, label: string, placeholder: string, mono = true) => (
    <label className="block text-[10px] font-medium text-text-3">{label}<input value={value[key]} onChange={(event) => setValue((current) => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} className={`mt-1 h-8 w-full rounded border border-border-1 bg-surface-0 px-2 text-[11px] text-text-1 outline-none focus:border-accent ${mono ? 'font-mono' : ''}`} /></label>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Run configuration" tabIndex={-1} className="w-[500px] overflow-hidden rounded-xl border border-border-2 bg-surface-1 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-10 items-center border-b border-border-1 px-4"><h2 className="text-xs font-semibold text-text-1">Run configuration</h2><button type="button" onClick={onClose} className="ml-auto grid h-6 w-6 place-items-center rounded text-text-3 hover:bg-surface-3"><X size={12} /></button></div>
        <div className="grid grid-cols-2 gap-3 p-4">{field('target', 'Target package or file', '.')}{field('workingDirectory', 'Working directory', 'Project root')}{field('goArguments', 'Go tool flags', '-race -v')}{field('programArguments', 'Program arguments', '--port 8080')}{field('buildTags', 'Build tags', 'integration,sqlite')}<label className="row-span-2 block text-[10px] font-medium text-text-3">Environment overrides<textarea value={value.environment} onChange={(event) => setValue((current) => ({ ...current, environment: event.target.value }))} placeholder={'APP_ENV=development\nPORT=8080'} className="mt-1 h-[92px] w-full resize-none rounded border border-border-1 bg-surface-0 p-2 font-mono text-[11px] text-text-1 outline-none focus:border-accent" /></label></div>
        <div className="border-t border-border-1 px-4 py-2 text-[9px] leading-4 text-text-4">Tool flags and program arguments stay separate and are passed directly to Go without shell concatenation. Environment values are never included in execution logs.</div>
        <div className="flex items-center justify-end gap-2 border-t border-border-1 bg-surface-0 px-4 py-3"><button type="button" onClick={onClose} className="h-7 rounded px-3 text-xs text-text-3 hover:bg-surface-2">Cancel</button><button type="button" onClick={() => { onSave(value); onClose() }} className="h-7 rounded bg-accent px-3 text-xs font-semibold text-white">Save configuration</button></div>
      </div>
    </div>
  )
}

