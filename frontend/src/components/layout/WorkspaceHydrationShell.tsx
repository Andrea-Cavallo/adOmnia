import { useUiTranslation } from '@/lib/uiI18n'

function Skeleton({ className }: { className: string }) {
  return <span aria-hidden="true" className={`block rounded adomnia-skeleton ${className}`} />
}

export function WorkspaceSidebarSkeleton({ quiet = false }: { quiet?: boolean }) {
  const tr = useUiTranslation()
  return (
    <aside
      className={`flex h-full min-h-0 w-full flex-shrink-0 flex-col border-r border-border-1 bg-surface-0${quiet ? ' workspace-shell-quiet' : ''}`}
      role="status"
      aria-label={tr('Loading…')}
    >
      <div className="border-b border-border-1 bg-surface-1/55 px-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <Skeleton className="h-2 w-20" />
          <Skeleton className="h-2 w-10 opacity-60" />
        </div>
        <Skeleton className="h-8 w-full" />
      </div>
      <div className="space-y-2 border-b border-border-1 px-3 py-2.5">
        <Skeleton className="h-7 w-full opacity-80" />
        <Skeleton className="h-7 w-full opacity-65" />
      </div>
      <div className="flex-1 space-y-3 px-3 py-4">
        <Skeleton className="h-3 w-2/3" />
        <div className="space-y-2 pl-2">
          <Skeleton className="h-2.5 w-4/5 opacity-80" />
          <Skeleton className="h-2.5 w-3/5 opacity-70" />
          <Skeleton className="h-2.5 w-5/6 opacity-60" />
        </div>
        <Skeleton className="mt-5 h-3 w-1/2 opacity-70" />
        <div className="space-y-2 pl-2">
          <Skeleton className="h-2.5 w-3/4 opacity-60" />
          <Skeleton className="h-2.5 w-1/2 opacity-50" />
        </div>
      </div>
    </aside>
  )
}

export function WorkspacePanelHeaderSkeleton({ quiet = false }: { quiet?: boolean }) {
  return (
    <div className={`flex h-10 flex-shrink-0 items-center gap-3 border-b border-border-1 bg-surface-1 px-3${quiet ? ' workspace-shell-quiet' : ''}`}>
      <Skeleton className="h-5 w-5 opacity-55" />
      <Skeleton className="h-2.5 w-36" />
      <Skeleton className="ml-auto h-5 w-5 opacity-55" />
    </div>
  )
}

export function WorkspaceMainSkeleton({ quiet = false }: { quiet?: boolean }) {
  const tr = useUiTranslation()
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0${quiet ? ' workspace-shell-quiet' : ''}`}
      role="status"
      aria-label={tr('Loading…')}
    >
      <div className="flex h-9 flex-shrink-0 items-end gap-1 border-b border-border-1 bg-surface-1 px-2 pt-1">
        <Skeleton className="h-7 w-32 rounded-b-none" />
        <Skeleton className="h-7 w-28 rounded-b-none opacity-65" />
      </div>
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 px-3">
        <Skeleton className="h-7 w-16" />
        <Skeleton className="h-7 flex-1 opacity-75" />
        <Skeleton className="h-7 w-20" />
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex w-[60%] min-w-[280px] flex-col border-r border-border-1">
          <div className="flex h-9 items-center gap-2 border-b border-border-1 px-3">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="ml-auto h-5 w-20 opacity-55" />
          </div>
          <div className="flex gap-1 border-b border-border-1 px-3 pt-2">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-20 opacity-75" />
            <Skeleton className="h-7 w-14 opacity-55" />
          </div>
          <div className="flex-1 space-y-3 p-4">
            <Skeleton className="h-3 w-[72%]" />
            <Skeleton className="h-3 w-[48%] opacity-80" />
            <Skeleton className="h-3 w-[84%] opacity-65" />
            <Skeleton className="mt-6 h-24 w-full opacity-50" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 items-center gap-3 border-b border-border-1 px-3">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="ml-auto h-2.5 w-12 opacity-60" />
          </div>
          <div className="flex gap-1 border-b border-border-1 px-3 pt-2">
            <Skeleton className="h-7 w-14" />
            <Skeleton className="h-7 w-16 opacity-65" />
          </div>
          <div className="flex-1 space-y-3 p-4">
            <Skeleton className="h-3 w-[78%]" />
            <Skeleton className="h-3 w-[52%] opacity-80" />
            <Skeleton className="h-3 w-[68%] opacity-65" />
            <Skeleton className="h-3 w-[42%] opacity-55" />
          </div>
        </div>
      </div>
    </div>
  )
}
