import type { JVMHeapSample } from '../../../bindings/github.com/Andrea-Cavallo/adOmnia/internal/languages/java/models'

/** Quanti campioni tenere nel grafico: a un campione ogni 2 secondi sono circa 4 minuti. */
export const JVM_HISTORY_LIMIT = 120

/** Aggiunge un campione allo storico senza modificarlo; i più vecchi escono. */
export function pushSample(history: readonly JVMHeapSample[], sample: JVMHeapSample, limit = JVM_HISTORY_LIMIT): JVMHeapSample[] {
  return [...history, sample].slice(-limit)
}

/** Punti di una polilinea SVG `x,y x,y…` per i valori dati, scalati su [0, max] e sull'area width×height. */
export function sparkline(values: readonly number[], max: number, width: number, height: number): string {
  if (values.length === 0 || max <= 0) return ''
  const step = values.length > 1 ? width / (values.length - 1) : 0
  return values.map((value, index) => `${(index * step).toFixed(1)},${(height - Math.min(Math.max(value / max, 0), 1) * height).toFixed(1)}`).join(' ')
}

/** 143477 KB → "140.1 MB"; sopra il giga usa GB. */
export function formatKb(kb: number): string {
  if (!Number.isFinite(kb) || kb < 0) return '—'
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${Math.round(kb)} KB`
}

/** Pause totali del GC in percentuale del tempo di vita della JVM (0 se l'uptime non è noto). */
export function gcOverheadPercent(sample: JVMHeapSample): number {
  if (!sample.uptimeSeconds) return 0
  return ((sample.youngGcSeconds + sample.fullGcSeconds) / sample.uptimeSeconds) * 100
}
