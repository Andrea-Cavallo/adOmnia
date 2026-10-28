import { previewLanguage } from './codeStudioSourcePreviewLanguage'
import './codeStudioFunctionExplorer.css'
import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, WrapText } from 'lucide-react'
import { monaco } from '@/lib/monacoSetup'
import { useSettingsStore } from '@/stores/settings'

export function CodeStudioSourcePreview({
  code,
  path,
  startLine,
  truncated = false,
}: {
  code: string
  path: string
  startLine: number
  truncated?: boolean
}) {
  const theme = useSettingsStore((state) => state.settings.appearance.theme)
  const [themeEpoch, setThemeEpoch] = useState(0)
  const [wrap, setWrap] = useState(true)
  const [copyState, setCopyState] = useState('')
  const [colored, setColored] = useState<{
    key: string
    lines: string[]
  } | null>(null)
  const key = `${path}\u0000${code}\u0000${theme}\u0000${themeEpoch}`
  const lines = useMemo(() => code.replace(/\r\n/g, '\n').split('\n'), [code])
  useEffect(() => {
    const refresh = () => setThemeEpoch((epoch) => epoch + 1)
    window.addEventListener('adomnia:theme-tokens', refresh)
    return () => window.removeEventListener('adomnia:theme-tokens', refresh)
  }, [])
  useEffect(() => {
    let stale = false
    setCopyState('')
    // Monaco escapes source text before adding its token spans. No model or LSP document is created.
    monaco.editor
      .colorize(code, previewLanguage(path, monaco.languages.getLanguages()), {
        tabSize: 4,
      })
      .then((html) => {
        if (!stale) setColored({ key, lines: html.split(/<br\s*\/?>/gi) })
      })
      .catch(() => {
        if (!stale) setColored(null)
      })
    return () => {
      stale = true
    }
  }, [code, path, key])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopyState('Copied')
    } catch {
      setCopyState('Could not copy source')
    }
  }
  return (
    <div className="cs-source-preview">
      <div className="cs-source-tools">
        <span className="cs-source-language">
          {previewLanguage(path, monaco.languages.getLanguages())}
        </span>
        <span className="cs-source-feedback" role="status">
          {copyState}
        </span>
        <button
          type="button"
          aria-pressed={wrap}
          title="Toggle line wrapping"
          onClick={() => setWrap((value) => !value)}
        >
          <WrapText size={14} /> Wrap lines
        </button>
        <button type="button" onClick={() => void copy()} disabled={!code}>
          {copyState === 'Copied' ? <Check size={14} /> : <Copy size={14} />}{' '}
          Copy source
        </button>
      </div>
      <div
        className="cs-source-scroll"
        role="region"
        aria-label="Source code"
        tabIndex={0}
      >
        <pre className="cs-source-code">
          <code>
            {lines.map((line, index) => (
              <span className="cs-source-line" key={index}>
                <span className="cs-source-number" aria-hidden="true">
                  {Math.max(1, startLine) + index}
                </span>
                {colored?.key === key && colored.lines[index] !== undefined ? (
                  <span
                    className={`cs-source-text ${wrap ? 'is-wrapped' : ''}`}
                    dangerouslySetInnerHTML={{
                      __html: colored.lines[index] || ' ',
                    }}
                  />
                ) : (
                  <span
                    className={`cs-source-text ${wrap ? 'is-wrapped' : ''}`}
                  >
                    {line || ' '}
                  </span>
                )}
              </span>
            ))}
          </code>
        </pre>
      </div>
      {truncated && (
        <p className="cs-source-truncated">
          Preview truncated. Open source to read the complete declaration.
        </p>
      )}
    </div>
  )
}
