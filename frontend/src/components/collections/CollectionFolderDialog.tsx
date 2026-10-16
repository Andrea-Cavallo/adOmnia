import { useEffect, useState } from 'react'
import { CheckCircle, FolderOpen, X, XCircle } from 'lucide-react'
import { DialogBody, DialogContent, DialogHeader, DialogOverlay } from '@/components/ui/dialog'
import { safeSelectFolder } from '@/lib/fileUtils'
import { loadLastRepo } from '@/lib/gitRepos'
import { useUiTranslation } from '@/lib/uiI18n'
import { cn } from '@/lib/utils'
import { CollectionFolderSection } from './CollectionFolderSection'

interface CollectionFolderDialogProps {
  open: boolean
  /** Collection preselected in the picker; empty falls back to the first one. */
  collectionId?: string
  onClose: () => void
}

/** Export/import a collection as a folder of files (one per request) that can live in any Git repository. */
export function CollectionFolderDialog({ open, collectionId = '', onClose }: CollectionFolderDialogProps) {
  const tr = useUiTranslation()
  const [folder, setFolder] = useState('')
  const [result, setResult] = useState<{ error?: string; info?: string }>({})

  // Start from the last repository the user worked with; they can pick any other folder.
  useEffect(() => {
    if (open) {
      setFolder((current) => current || loadLastRepo())
      setResult({})
    }
  }, [open])

  const browse = async () => {
    try {
      const picked = await safeSelectFolder(tr('Select the folder or Git repository to export to'))
      if (picked) setFolder(picked)
    } catch (error) {
      setResult({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <DialogOverlay open={open} onClose={onClose}>
      <DialogContent size="md">
        <DialogHeader>
          <span className="text-sm font-semibold text-text-1">{tr('Collection folder')}</span>
          <button onClick={onClose} title={tr('Close')} aria-label={tr('Close')} className="text-text-4 transition-colors hover:text-text-1">
            <X size={16} />
          </button>
        </DialogHeader>
        <DialogBody className="space-y-3 p-4">
          <p className="text-xs text-text-3">
            {tr('Writes the collection as readable files under adomnia-collections/ in the chosen folder, so it can be committed and reviewed with Git.')}
          </p>
          <div className="flex gap-2">
            <input
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder={tr('Folder or repository path...')}
              aria-label={tr('Target folder')}
              className="h-8 min-w-0 flex-1 rounded border border-border-1 bg-surface-0 px-2 text-xs text-text-1 outline-none focus:border-accent"
            />
            <button onClick={() => void browse()} title={tr('Browse')} aria-label={tr('Browse')} className="flex h-8 items-center rounded border border-border-1 px-2 text-text-3 hover:bg-surface-2 hover:text-text-1">
              <FolderOpen size={13} />
            </button>
          </div>
          <CollectionFolderSection bare repoPath={folder.trim()} initialCollectionId={collectionId} onResult={setResult} />
          {(result.error || result.info) && (
            <div role={result.error ? 'alert' : 'status'} className={cn('flex items-center gap-2 rounded border px-3 py-2 text-xs', result.error ? 'border-error/30 bg-error/10 text-error' : 'border-success/30 bg-success/10 text-success')}>
              {result.error ? <XCircle size={13} className="shrink-0" /> : <CheckCircle size={13} className="shrink-0" />}
              <span className="min-w-0 break-words">{result.error || result.info}</span>
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </DialogOverlay>
  )
}
