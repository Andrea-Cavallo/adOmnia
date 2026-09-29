import { Bug, ChevronDown, ChevronRight, Cog, FileText, Files, FlaskConical, Folder, GitBranch, Search, X } from 'lucide-react'
import goMark from './assets/go-mark.png'

/**
 * Static illustration of Go Studio for the Hub hero. It is decoration only:
 * Go Studio itself stays lazy and is never imported from startup code.
 */

const TREE: Array<{ depth: number; label: string; kind: 'dir' | 'open' | 'file' | 'go'; active?: boolean }> = [
  { depth: 0, label: 'go-api', kind: 'open' },
  { depth: 1, label: 'cmd', kind: 'open' },
  { depth: 2, label: 'server', kind: 'open' },
  { depth: 3, label: 'main.go', kind: 'go', active: true },
  { depth: 1, label: 'internal', kind: 'dir' },
  { depth: 1, label: 'pkg', kind: 'dir' },
  { depth: 1, label: 'api', kind: 'dir' },
  { depth: 1, label: 'configs', kind: 'dir' },
  { depth: 1, label: 'scripts', kind: 'file' },
  { depth: 1, label: 'go.mod', kind: 'file' },
  { depth: 1, label: 'README.md', kind: 'file' },
]

const K = 'text-accent-light'
const S = 'text-success'
const F = 'text-info'

// Each line is a list of [text, className] tokens.
const CODE: Array<Array<[string, string?]>> = [
  [['package ', K], ['main']],
  [],
  [['import', K], [' (']],
  [['    '], ['"fmt"', S]],
  [['    '], ['"net/http"', S]],
  [['    '], ['"log"', S]],
  [[')']],
  [['func ', K], ['main', F], ['() {']],
  [['    mux := http.'], ['NewServeMux', F], ['()']],
  [['    mux.'], ['HandleFunc', F], ['('], ['"/"', S], [', '], ['func', K], ['(w http.ResponseWriter, r *http.Request) {']],
  [['        fmt.'], ['Fprintf', F], ['(w, '], ['"Hello from adOmnia gO Studio!\\n"', S], [')']],
  [['    })']],
  [['    log.'], ['Println', F], ['('], ['"Server running on http://localhost:8080"', S], [')']],
  [['    log.'], ['Fatal', F], ['(http.'], ['ListenAndServe', F], ['('], ['":8080"', S], [', mux))']],
  [['}']],
]

const STRUCTURE: Array<{ depth: number; label: string }> = [
  { depth: 0, label: 'main' },
  { depth: 1, label: 'main()' },
  { depth: 2, label: 'mux' },
  { depth: 1, label: 'server handlers' },
  { depth: 2, label: '/' },
  { depth: 2, label: 'routes' },
  { depth: 1, label: 'dependencies' },
  { depth: 2, label: 'fmt' },
  { depth: 2, label: 'net/http' },
  { depth: 2, label: 'log' },
]

export function HubGoStudioPreview() {
  return (
    <div
      aria-hidden
      className="pointer-events-none flex min-w-0 flex-col overflow-hidden rounded-xl border border-border-1 bg-surface-0 font-mono text-[10.5px] leading-[1.55] text-text-2 shadow-[0_20px_60px_-30px_var(--color-accent)]"
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border-1 bg-surface-1 pl-2 pr-3">
        <img src={goMark} alt="" className="h-5 w-5 object-contain" />
        <span className="flex items-center gap-2 rounded-t border-x border-t border-border-1 bg-surface-0 px-3 py-1 text-text-1">
          <span className="text-info">∞</span> main.go <X size={10} className="text-text-3" />
        </span>
        <span className="text-text-3">+</span>
        <span className="ml-auto flex gap-4 text-text-3">— ▢ ✕</span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[28px_150px_minmax(0,1fr)_140px] max-2xl:grid-cols-[28px_130px_minmax(0,1fr)]">
        <div className="flex flex-col items-center gap-3 border-r border-border-1 bg-surface-1 pt-2 text-text-3">
          <Files size={13} /><Search size={13} /><Bug size={13} /><GitBranch size={13} /><FlaskConical size={13} />
          <Cog size={13} className="mt-auto mb-2" />
        </div>

        <div className="border-r border-border-1 px-2 py-1.5">
          <p className="m-0 mb-1 text-[9.5px] uppercase tracking-wider text-text-3">Explorer</p>
          {TREE.map((item) => (
            <div
              key={`${item.depth}-${item.label}`}
              className={`flex items-center gap-1 truncate rounded-sm ${item.active ? 'bg-accent/20 text-text-1' : ''}`}
              style={{ paddingLeft: item.depth * 9 }}
            >
              {item.kind === 'open' ? <ChevronDown size={10} /> : item.kind === 'dir' ? <ChevronRight size={10} /> : <span className="w-[10px]" />}
              {item.kind === 'go'
                ? <span className="text-[9px] font-bold text-info">go</span>
                : item.kind === 'file' ? <FileText size={10} className="text-text-3" /> : <Folder size={10} className="text-text-3" />}
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="flex h-6 items-center gap-2 border-b border-border-1 px-2 text-text-1">
            <span className="text-info">∞</span> main.go <X size={10} className="text-text-3" />
          </div>
          <div className="min-h-0 flex-1 overflow-hidden px-1 py-1">
            {CODE.map((line, index) => (
              <div key={index} className="flex whitespace-pre">
                <span className="w-6 shrink-0 pr-2 text-right text-text-4">{index + 1}</span>
                <span className="overflow-hidden text-ellipsis text-text-1">
                  {line.map(([text, cls], i) => <span key={i} className={cls}>{text}</span>)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t border-border-1">
            <div className="flex gap-4 px-2 py-1 text-[9.5px] uppercase text-text-3">
              <span>Problems</span><span>Output</span><span>Debug console</span>
              <span className="border-b border-accent text-text-1">Terminal</span>
            </div>
            <div className="px-2 pb-2 text-text-1">
              <div><span className="text-success">›</span> go run ./cmd/server</div>
              <div className="text-text-2">Server running on http://localhost:8080</div>
            </div>
          </div>
        </div>

        <div className="border-l border-border-1 px-2 py-1.5 max-2xl:hidden">
          <p className="m-0 mb-1 text-[9.5px] uppercase tracking-wider text-text-3">Structure</p>
          {STRUCTURE.map((item) => (
            <div key={`${item.depth}-${item.label}`} className="flex items-center gap-1 truncate" style={{ paddingLeft: item.depth * 9 }}>
              <span className="h-2 w-2 shrink-0 rounded-sm border border-accent-light/70" />
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
