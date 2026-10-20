import { useSettingsStore } from '@/stores/settings'
import { DEFAULT_TERMINAL_APPEARANCE, terminalAppearance, type TerminalAppearance } from '@/lib/code-studio/terminalAppearance'
import { TERMINAL_THEMES } from './codeStudioTerminalTheme'
import { CodeStudioButton, CodeStudioField, CodeStudioModal } from './CodeStudioModal'

export function CodeStudioTerminalAppearance({ onClose }: { onClose: () => void }) {
  const saved = useSettingsStore((state) => state.settings.appearance.terminal)
  const options = terminalAppearance(saved)
  const update = (patch: Partial<TerminalAppearance>) => useSettingsStore.getState().updateAppearance({ terminal: { ...options, ...patch } })
  return <CodeStudioModal open onClose={onClose} title="Terminal appearance" subtitle="Live preview on every shell. Saved locally; sessions keep running." size="lg" divided
    className="gs-terminal-appearance" footerStart="Applies to terminal windows only."
    footer={<><CodeStudioButton onClick={() => update(DEFAULT_TERMINAL_APPEARANCE)}>Reset</CodeStudioButton><CodeStudioButton onClick={onClose}>Done</CodeStudioButton></>}>
    <div className="terminal-theme-grid" role="group" aria-label="Terminal theme">
      {TERMINAL_THEMES.map((preset) => <button key={preset.id} type="button" aria-pressed={options.preset === preset.id} onClick={() => update({ preset: preset.id })}
        className="terminal-theme-card" style={{ background: preset.colors.background, color: preset.colors.foreground }}>
        <span className="terminal-theme-sample" aria-hidden="true"><span style={{ color: preset.colors.green }}>$</span> go test ./...<br /><span style={{ color: preset.link }}>ok</span> <span style={{ color: preset.colors.brightBlack }}>workspace</span><span style={{ color: preset.colors.cursor }}> ▏</span></span>
        <span className="terminal-theme-name">{preset.name}<span aria-hidden="true">{options.preset === preset.id ? '●' : '○'}</span></span>
        <span className="terminal-theme-swatches" aria-hidden="true">{['red','green','yellow','blue','magenta','cyan'].map((key) => <i key={key} style={{ background: preset.colors[key as 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan'] }} />)}</span>
      </button>)}
    </div>
    <div className="terminal-appearance-fields">
      <CodeStudioField label="Font"><select className="gs-input" value={options.fontFamily} onChange={(event) => update({ fontFamily: event.target.value })}>
        <option value="">Code Studio font</option><option value="JetBrains Mono, monospace">JetBrains Mono</option><option value="Geist Mono, monospace">Geist Mono</option><option value="Consolas, monospace">Consolas / system fallback</option>
      </select></CodeStudioField>
      <CodeStudioField label={`Font size / ${options.fontSize} px`}><input className="gs-input" type="range" min="10" max="24" value={options.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })} /></CodeStudioField>
      <CodeStudioField label="Line height"><input className="gs-input" aria-label="Terminal line height" type="number" min="1" max="1.8" step="0.05" value={options.lineHeight} onChange={(event) => update({ lineHeight: Number(event.target.value) })} /></CodeStudioField>
      <CodeStudioField label="Letter spacing"><input className="gs-input" type="number" min="-1" max="3" step="0.25" value={options.letterSpacing} onChange={(event) => update({ letterSpacing: Number(event.target.value) })} /></CodeStudioField>
      <CodeStudioField label="Cursor"><select className="gs-input" value={options.cursorStyle} onChange={(event) => update({ cursorStyle: event.target.value as TerminalAppearance['cursorStyle'] })}><option value="bar">Bar</option><option value="block">Block</option><option value="underline">Underline</option></select></CodeStudioField>
      <CodeStudioField label="Scrollback lines"><select className="gs-input" value={options.scrollback} onChange={(event) => update({ scrollback: Number(event.target.value) })}>{[1000,5000,10000,20000].map((count) => <option key={count} value={count}>{count.toLocaleString()}</option>)}</select></CodeStudioField>
      <label className="terminal-cursor-toggle"><input type="checkbox" checked={options.cursorBlink} onChange={(event) => update({ cursorBlink: event.target.checked })} /> Blink cursor</label>
    </div>
  </CodeStudioModal>
}
