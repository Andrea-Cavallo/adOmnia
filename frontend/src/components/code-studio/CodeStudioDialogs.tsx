import { useEffect, useState } from 'react'
import { AlertCircle, FolderOpen, FolderPlus, Save, ShieldAlert } from 'lucide-react'
import { chooseGoIDEProjectParent, listGoIDEProjectTemplates, type GoIDEProjectTemplateList } from '@/lib/code-studio-api'
import { CodeStudioAlert, CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'
import { CodeStudioUnsavedFileList } from './CodeStudioUnsavedFileList'
import { useCodeStudioStore, type GoIDEEditorDocument } from '@/stores/codeStudio'

export interface CodeStudioRunDraft {
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
  const createProject = useCodeStudioStore((state) => state.createProject)

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
  // Un template con un linguaggio (sito statico, Node…) non esegue comandi: niente module path.
  const goTemplate = !selected?.language
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
    <CodeStudioModal
      open={open}
      onClose={onClose}
      size="lg"
      divided
      icon={FolderPlus}
      title="Create project"
      subtitle={goTemplate ? 'A new folder with go.mod, ready to build and run.' : `A new folder with ${selected?.name.toLowerCase()} files, ready to open.`}
      footer={<>
        <CodeStudioButton variant="ghost" onClick={onClose}>Cancel</CodeStudioButton>
        <CodeStudioButton variant="primary" loading={submitting} disabled={!parentPath || !name || (goTemplate && !modulePath)} onClick={() => void submit()}>Create & initialize</CodeStudioButton>
      </>}
    >
      <section className="flex flex-col gap-2">
        <h3 className="gs-section-title">Template</h3>
        {templatesError && <CodeStudioAlert icon={AlertCircle}>{templatesError}</CodeStudioAlert>}
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
      <CodeStudioField label="Parent folder">
        <div className="flex gap-2">
          <input readOnly value={parentPath} placeholder="Choose a local folder" className="gs-input gs-mono flex-1" />
          <CodeStudioButton variant="secondary" icon={FolderOpen} onClick={() => void chooseParent()}>Choose…</CodeStudioButton>
        </div>
      </CodeStudioField>
      <div className="grid grid-cols-2 gap-3">
        <CodeStudioField label="Project name"><input value={name} onChange={(event) => setName(event.target.value)} placeholder="hello-service" className="gs-input" /></CodeStudioField>
        {goTemplate && <CodeStudioField label="Module path"><input value={modulePath} onChange={(event) => setModulePath(event.target.value)} placeholder={`example.com/${name || 'hello-service'}`} className="gs-input gs-mono" /></CodeStudioField>}
      </div>
      {!goTemplate && <CodeStudioAlert icon={ShieldAlert}>Writes the template files into a new folder. No command runs and nothing is downloaded.</CodeStudioAlert>}
      {goTemplate && <CodeStudioAlert tone="warning" icon={ShieldAlert}>
        Runs <code className="gs-mono text-text-1">go mod init {modulePath || '<module-path>'}</code> in the new empty folder{selected && selected.id !== 'empty' && ' and writes the template files'}.
        {selected?.requires?.length ? <> Then <code className="gs-mono text-text-1">go mod tidy</code> for {selected.requires.join(', ')}, which may download modules missing from the local cache.</> : ' No dependencies are downloaded and no project code runs.'}
      </CodeStudioAlert>}
    </CodeStudioModal>
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
    <CodeStudioModal
      open={open}
      onClose={onCancel}
      size="sm"
      icon={Save}
      tone="warning"
      title="Save changes before closing?"
      subtitle={`${documents.length} file${documents.length === 1 ? ' has' : 's have'} unsaved changes.`}
      footer={<>
        <CodeStudioButton variant="ghost" onClick={onCancel}>Cancel</CodeStudioButton>
        <CodeStudioButton variant="danger-ghost" onClick={() => void onDiscard()}>Discard</CodeStudioButton>
        <CodeStudioButton variant="primary" data-autofocus loading={saving} onClick={() => { setSaving(true); void onSave().finally(() => setSaving(false)) }}>Save</CodeStudioButton>
      </>}
    >
      <CodeStudioUnsavedFileList documents={documents} />
    </CodeStudioModal>
  )
}
