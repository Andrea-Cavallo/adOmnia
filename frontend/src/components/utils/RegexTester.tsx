import { useState, useEffect } from 'react'

export function RegexTester() {
  const [pattern, setPattern] = useState('Bearer\\s+(.+)')
  const [flags, setFlags] = useState('g')
  const [input, setInput] = useState('Authorization: Bearer demo-token-123\nX-Request-ID: req_42')
  const [matches, setMatches] = useState<RegExpMatchArray[]>([])

  useEffect(() => {
    if (!pattern) { setMatches([]); return }
    try {
      const re = new RegExp(pattern, flags)
      const results = [...input.matchAll(re)]
      setMatches(results)
    } catch {
      setMatches([])
    }
  }, [pattern, flags, input])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-4">/</span>
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="regex pattern"
          className="flex-1 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none"
        />
        <span className="text-[10px] text-text-4">/</span>
        <input
          value={flags}
          onChange={(e) => setFlags(e.target.value)}
          placeholder="g"
          className="w-12 h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none"
        />
      </div>
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Test input..."
        rows={5}
        className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono placeholder:text-text-4 focus:border-accent outline-none resize-none"
      />
      <div className="text-xs">
        <p className="text-text-3 mb-1">Matches: {matches.length}</p>
        {matches.map((m, i) => (
          <div key={i} className="flex gap-2 font-mono text-text-2">
            <span className="text-text-4">[{i}]</span>
            <span className="text-green-400">"{m[0]}"</span>
            <span className="text-text-4">at index {m.index}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
