import { useState } from 'react'
import { ArrowLeft, Download, Trash2, Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Template } from '@/lib/plugins-api'
import { exportTemplate, deleteTemplate } from '@/lib/plugins-api'

interface TemplateDetailProps {
  template: Template
  isInstalled: boolean
  onInstall: () => void
  onBack: () => void
}

export function TemplateDetail({ template, isInstalled, onInstall, onBack }: TemplateDetailProps) {
  const [copied, setCopied] = useState(false)

  const handleExport = async () => {
    const json = await exportTemplate(template.id)
    if (json) {
      await navigator.clipboard.writeText(json)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleUninstall = async () => {
    await deleteTemplate(template.id)
    onBack()
  }

  const formattedContent = (() => {
    try {
      return JSON.stringify(JSON.parse(template.content), null, 2)
    } catch {
      return template.content
    }
  })()

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-0">
      <header className="flex items-center gap-3 px-6 py-4 border-b border-border-1 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-text-3 hover:text-text-1 transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="flex-1" />
        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-text-2 hover:text-text-1 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Export'}
        </button>
        {isInstalled ? (
          <button
            onClick={handleUninstall}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-surface-1 hover:bg-surface-2 border border-border-1 rounded-md transition-colors"
          >
            <Trash2 size={13} />
            Uninstall
          </button>
        ) : (
          <button
            onClick={onInstall}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-accent hover:opacity-90 rounded-md transition-colors"
          >
            <Download size={13} />
            Install
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl space-y-6">
          <section className="space-y-3">
            <h1 className="text-xl font-bold text-text-1">{template.name}</h1>
            <div className="flex items-center gap-3 text-xs text-text-3">
              <span>by <span className="text-text-2 font-medium">{template.author}</span></span>
              <span className="w-1 h-1 rounded-full bg-text-4" />
              <span>v{template.version}</span>
              <span className="w-1 h-1 rounded-full bg-text-4" />
              <span className={cn(
                'px-1.5 py-0.5 font-medium rounded',
                'bg-accent/10 text-accent'
              )}>
                {template.category}
              </span>
            </div>
            <p className="text-sm text-text-2 leading-relaxed">{template.description}</p>
          </section>

          {template.tags.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-xs font-medium uppercase tracking-wider text-text-4">Tags</h3>
              <div className="flex flex-wrap gap-1.5">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-[10px] font-medium bg-surface-2 text-text-3 rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-text-4">Content Preview</h3>
            <div className="rounded-lg border border-border-1 bg-surface-1 overflow-hidden">
              <pre className="p-4 text-xs font-mono text-text-2 overflow-x-auto max-h-96 overflow-y-auto leading-relaxed">
                {formattedContent || 'No content available.'}
              </pre>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wider text-text-4">Metadata</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="px-3 py-2 rounded-md bg-surface-1 border border-border-1">
                <p className="text-[10px] text-text-4 uppercase tracking-wider mb-0.5">Created</p>
                <p className="text-xs text-text-2">{new Date(template.createdAt).toLocaleDateString()}</p>
              </div>
              <div className="px-3 py-2 rounded-md bg-surface-1 border border-border-1">
                <p className="text-[10px] text-text-4 uppercase tracking-wider mb-0.5">Updated</p>
                <p className="text-xs text-text-2">{new Date(template.updatedAt).toLocaleDateString()}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
