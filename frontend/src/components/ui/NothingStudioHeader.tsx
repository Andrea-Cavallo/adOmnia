import './nothingStudio.css'

/** Shared studio identity: dot lettering, palette ink and restrained technical labels. */
export function NothingStudioHeader({ title, section, detail, count }: { title: string; section: string; detail: string; count: string }) {
  return <header className="nothing-studio-header">
    <div className="nothing-studio-emblem" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
    <div className="min-w-0">
      <p className="nothing-studio-label">{section}</p>
      <h1>{title}</h1>
    </div>
    <p className="nothing-studio-description">{detail}</p>
    <div className="nothing-studio-count"><span className="nothing-studio-dot" />{count}</div>
  </header>
}
