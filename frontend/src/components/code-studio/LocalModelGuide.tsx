import { Browser } from '@wailsio/runtime'

export type LocalRuntime = 'unsloth' | 'ollama' | 'lmstudio' | 'custom'

export function LocalModelGuide({ runtime, onChoose }: { runtime: LocalRuntime; onChoose: (runtime: LocalRuntime) => void }) {
  return <div className="local-model-guide">
    <h3>Where should the model run?</h3>
    <div className="local-llm-presets">{(['unsloth', 'ollama', 'lmstudio', 'custom'] as const).map(id => <button key={id} type="button" aria-pressed={runtime === id} onClick={() => onChoose(id)}>{({ unsloth: 'Unsloth', ollama: 'Ollama', lmstudio: 'LM Studio', custom: 'Other' })[id]}</button>)}</div>
    {runtime === 'unsloth' ? <>
      <p>In Unsloth, download and load a chat model that fits your device. Create a key in Settings → API and paste it below.</p>
      <button type="button" onClick={() => void Browser.OpenURL('https://unsloth.ai/download')}>Get Unsloth</button>{' '}
      <button type="button" onClick={() => void Browser.OpenURL('https://unsloth.ai/docs/basics/api')}>Connection guide</button>
      <p>Copy the address shown in Unsloth and append /v1. The port is usually 8000 or 8888. Model downloads and training stay in Unsloth.</p>
    </> : runtime === 'ollama' ? <p>Connect starts Ollama if installed. Choose an existing model or enter its ID and explicitly download it.</p> : runtime === 'lmstudio' ? <p>Load a chat model in LM Studio, then start the local server from Developer.</p> : <p>Start your local OpenAI-compatible server and enter its /v1 address below.</p>}
  </div>
}
