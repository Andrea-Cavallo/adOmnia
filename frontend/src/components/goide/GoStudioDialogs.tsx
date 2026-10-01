import { useEffect, useState } from 'react'
import { AlertCircle, FolderOpen, FolderPlus, Save, ShieldAlert } from 'lucide-react'
import { chooseGoIDEProjectParent, listGoIDEProjectTemplates, type GoIDEProjectTemplateList } from '@/lib/goide-api'
import { GoStudioAlert, GoStudioButton, GoStudioField, GoStudioModal } from './GoStudioModal'
import { GoStudioUnsavedFileList } from './GoStudioUnsavedFileList'
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
  const [templateId, setTemplateId] = useState('empty')
  const [templates, setTemplates] = useState<GoIDEProjectTemplateList | null>(null)
  const [templatesError, setTemplatesError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const createProject = useGoIDEStore((state) => state.createProject)

  useEffect(() => {
    if (!open) return
    setParentPath('')
    setName('')
    setModulePath('')
    setTemplateId('empty')
    setTemplatesError('')
    listGoIDEProjectTemplates().then(setTemplates).catch((error: unknown) => setTemplatesError(String(error)))
  }, [open])

  if (!open) return null

  const selected = templates?.templates.find((template) => template.id === templateId)
  const chooseParent = async () => {
    const path = await chooseGoIDEProjectParent()
    if (path) setParentPath(path)
  }
  const submit = async () => {
    setSubmitting(true)
    const created = await createProject(parentPath, name, modulePath, templateId)
    setSubmitting(false)
    if (created) onClose()
  }

  return (
    <GoStudioModal
      open={open}
      onClose={onClose}
      size="lg"
      divided
      icon={FolderPlus}
      title="Create Go project"
      subtitle="A new folder with go.mod, ready to build and run."
      footer={<>
        <GoStudioButton variant="ghost" onClick={onClose}>Cancel</GoStudioButton>
        <GoStudioButton variant="primary" loading={submitting} disabled={!parentPath || !name || !modulePath} onClick={() => void submit()}>Create & initialize</GoStudioButton>
      </>}
    >
      <section className="flex flex-col gap-2">
        <h3 className="gs-section-title">Template</h3>
        {templatesError && <GoStudioAlert icon={AlertCircle}>{templatesError}</GoStudioAlert>}
        <div role="radiogroup" aria-label="Project template" className="grid grid-cols-2 gap-2">
          {(templates?.templates ?? []).map((template) => {
            const active = template.id === templateId
            return (
              <button key={template.id} type="button" role="radio" aria-checked={active} onClick={() => setTemplateId(template.id)}
                className={`rounded-[10px] border px-3 py-2.5 text-left transition-colors ${active ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_var(--color-accent)]' : 'border-border-1 bg-surface-0 hover:border-border-2 hover:bg-surface-2/40'}`}>
                <span className="flex items-center gap-2 text-[13px] font-medium text-text-1">{template.name}{template.custom && <span className="gs-badge h-[18px] text-[10.5px]">custom</span>}</span>
                <span className="mt-0.5 block truncate text-[12px] text-text-3" title={template.description}>{template.description}</span>
              </button>
            )
          })}
        </div>
        {templates?.customDirectory && <p className="gs-hint">Custom templates live in <code className="gs-mono select-all text-text-3">{templates.customDirectory}</code>. <code className="gs-mono">__MODULE__</code>, <code className="gs-mono">__NAME__</code> and <code className="gs-mono">__PACKAGE__</code> are replaced in contents and paths.</p>}
      </section>
      <GoStudioField label="Parent folder">
        <div className="flex gap-2">
          <input readOnly value={parentPath} placeholder="Choose a local folder" className="gs-input gs-mono flex-1" />
          <GoStudioButton variant="secondary" icon={FolderOpen} onClick={() => void chooseParent()}>Choose…</GoStudioButton>
        </div>
      </GoStudioField>
      <div className="grid grid-cols-2 gap-3">
        <GoStudioField label="Project name"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="hello-service" className="gs-input" /></GoStudioField>
        <GoStudioField label="Module path"><input value={modulePath} onChange={(event) => setModulePath(event.target.value)} placeholder={`example.com/${name || 'hello-service'}`} className="gs-input gs-mono" /></GoStudioField>
      </div>
      <GoStudioAlert tone="warning" icon={ShieldAlert}>
        Runs <code className="gs-mono text-text-1">go mod init {modulePath || '<module-path>'}</code> in the new empty folder{selected && selected.id !== 'empty' && ' and writes the template files'}.
        {selected?.requires?.length ? <> Then <code className="gs-mono text-text-1">go mod tidy</code> for {selected.requires.join(', ')}, which may download modules missing from the local cache.</> : ' No dependencies are downloaded and no project code runs.'}
      </GoStudioAlert>
    </GoStudioModal>
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
  return (
    <GoStudioModal
      open={open}
      onClose={onCancel}
      size="sm"
      icon={Save}
      tone="warning"
      title="Save changes before closing?"
      subtitle={`${documents.length} file${documents.length === 1 ? ' has' : 's have'} unsaved changes.`}
      footer={<>
        <GoStudioButton variant="ghost" onClick={onCancel}>Cancel</GoStudioButton>
        <GoStudioButton variant="danger-ghost" onClick={() => void onDiscard()}>Discard</GoStudioButton>
        <GoStudioButton variant="primary" data-autofocus loading={saving} onClick={() => { setSaving(true); void onSave().finally(() => setSaving(false)) }}>Save</GoStudioButton>
      </>}
    >
      <GoStudioUnsavedFileList documents={documents} />
    </GoStudioModal>
  )
}
