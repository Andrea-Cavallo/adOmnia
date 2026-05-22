import { useState } from 'react'

export function HmacTool() {
  const [input, setInput] = useState('{"event":"payment.succeeded","id":"evt_1001"}')
  const [secret, setSecret] = useState('local-webhook-secret')
  const [algorithm, setAlgorithm] = useState('SHA-256')
  const [output, setOutput] = useState('')

  const generate = async () => {
    try {
      const enc = new TextEncoder()
      const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: algorithm }, false, ['sign'])
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(input))
      setOutput(Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join(''))
    } catch {
      setOutput('Generation error')
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)} className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 outline-none">
          <option>SHA-1</option>
          <option>SHA-256</option>
          <option>SHA-384</option>
          <option>SHA-512</option>
        </select>
      </div>
      <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Secret key" className="h-7 px-2 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none" />
      <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="Data to sign" rows={3} className="px-2 py-1.5 bg-surface-2 border border-border-2 rounded text-xs text-text-1 font-mono focus:border-accent outline-none resize-none" />
      <button onClick={generate} className="self-start px-3 py-1.5 bg-accent text-white rounded text-xs font-medium">Generate HMAC</button>
      {output && <pre className="px-3 py-2 bg-surface-1 border border-border-1 rounded text-xs text-text-1 font-mono break-all">{output}</pre>}
    </div>
  )
}
