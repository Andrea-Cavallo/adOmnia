import type { GoIDEEditorDocument } from '@/stores/goide'
import { GoStudioFileIcon } from './GoStudioFileIcon'

function parentFolder(relativePath: string): string {
  const index = relativePath.lastIndexOf('/')
  return index < 0 ? '' : relativePath.slice(0, index)
}

/** File con modifiche non salvate: icona, nome, cartella e pallino, come nelle tab. */
export function GoStudioUnsavedFileList({ documents }: { documents: GoIDEEditorDocument[] }) {
  if (documents.length === 0) return null
  return (
    <div className="gs-list max-h-44">
      {documents.map((document) => (
        <div key={document.document.id} className="gs-list-row min-h-[34px] py-1.5" title={document.document.relativePath}>
          <GoStudioFileIcon name={document.document.name} relativePath={document.document.relativePath} />
          <span className="truncate text-[12.5px] text-text-1">{document.document.name}</span>
          <span className="truncate text-[12px] text-text-4">{parentFolder(document.document.relativePath)}</span>
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-label="unsaved" />
        </div>
      ))}
    </div>
  )
}
