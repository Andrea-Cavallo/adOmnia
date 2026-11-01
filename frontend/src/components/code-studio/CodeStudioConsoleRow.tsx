import type { ReactNode } from 'react'
import type { ConsoleParsedLine } from './codeStudioConsoleLines'

export function CodeStudioConsoleRow({ line, wrap, className, children, onNavigate }: { line: ConsoleParsedLine; wrap: boolean; className: string; children: ReactNode; onNavigate?: () => void }) {
  const textStyle = wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre'
  return <div className={`code-studio-console-line min-h-6 border-l-2 py-px pl-3 ${line.stream === 'system' ? 'my-2 border-border-2 text-[12px]' : line.path ? 'border-current/30' : 'border-transparent'} ${textStyle} ${className}`}>
    {onNavigate ? <button type="button" onClick={onNavigate} title="Open source location" className="text-left underline decoration-current/40 underline-offset-4 hover:text-accent">{children}</button> : children}
  </div>
}
