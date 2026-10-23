export interface BuildKitStep { id: string; title: string; state: 'running' | 'cached' | 'done' | 'error' | 'cancelled'; duration?: string }
/** BuildKit --progress=plain is already used by the backend. Keep the last state
 * per step, including cached stages and failures, without interpreting shell text. */
export function buildKitProgress(text: string): BuildKitStep[] {
  const steps = new Map<string, BuildKitStep>()
  for (const line of text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').split(/\r?\n/)) {
    const match = /^#(\d+)\s+(\S.*)$/.exec(line)
    if (!match) continue
    const [,id,body] = match
    const terminal = /^(DONE|CACHED|ERROR|CANCELED)(?:\s+(\S.*))?$/.exec(body)
    const existing = steps.get(id)
    if (terminal && existing) {
      const states = { DONE:'done', CACHED:'cached', ERROR:'error', CANCELED:'cancelled' } as const
      existing.state = states[terminal[1] as keyof typeof states]
      existing.duration = terminal[2]
    } else if (/^\[|^exporting|^resolving/.test(body)) {
      steps.set(id,{id,title:body,state:'running'})
    }
  }
  return [...steps.values()].slice(-200)
}
