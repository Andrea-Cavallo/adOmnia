import type { BundleDetail } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/eclipsepde/models'
import { useCodeStudioStore } from '@/stores/codeStudio'

function open(file: string, line: number): void {
  void useCodeStudioStore.getState().openLocation(file, line, 1)
}

/** plugin.xml del bundle: gli extension point che dichiara (con chi li estende) e le estensioni che contribuisce. */
export function ExtensionsSection({ detail }: { detail: BundleDetail }) {
  const points = detail.extensionPoints ?? []
  const extensions = detail.extensions ?? []
  if (points.length === 0 && extensions.length === 0) return null
  return (
    <section aria-label="Extensions" className="border-b border-border-1 px-3 py-1.5">
      {points.length > 0 && (
        <>
          <h3 className="pb-1 text-[11px] font-medium text-text-2">Extension points ({points.length})</h3>
          {points.map((point) => (
            <p key={point.id} className="truncate text-[10.5px] text-text-3" title={point.id}>
              <span className="font-mono text-text-2">{point.id}</span>
              {point.name ? ` · ${point.name}` : ''}
              {` · ${(point.contributors ?? []).length > 0 ? `extended by ${(point.contributors ?? []).join(', ')}` : 'no workspace extension'}`}
            </p>
          ))}
        </>
      )}
      {extensions.length > 0 && (
        <>
          <h3 className="pb-1 pt-1 text-[11px] font-medium text-text-2">Extensions ({extensions.length})</h3>
          <div className="max-h-40 overflow-auto">
            {extensions.map((extension) => (
              <div key={`${extension.file}:${extension.line}`} className="py-0.5">
                <button type="button" className="block max-w-full truncate text-left font-mono text-[10.5px] text-text-2 hover:text-accent hover:underline" onClick={() => open(extension.file, extension.line)} title={`${extension.file}:${extension.line}`}>
                  {extension.point}{extension.id ? ` · ${extension.id}` : ''}
                </button>
                {(extension.classes ?? []).map((item) => (
                  <button
                    key={`${item.class}:${item.line}`}
                    type="button"
                    className={`block max-w-full truncate pl-3 text-left font-mono text-[10.5px] hover:underline ${item.source ? 'text-text-3 hover:text-accent' : 'text-text-4'}`}
                    onClick={() => (item.source ? open(item.source, 1) : open(extension.file, item.line))}
                    title={item.source ? `Open ${item.source}` : `${item.class} is not in this bundle's sources`}
                  >
                    {item.attribute}: {item.class}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
