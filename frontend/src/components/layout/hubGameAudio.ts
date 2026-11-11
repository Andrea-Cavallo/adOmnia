/**
 * Tiny synthesized sound effects for the Hub game. No assets and no dependencies: a handful of
 * oscillators shaped into short arcade hits, blocks, coins and bells. Everything is wrapped, so a
 * browser that blocks audio never breaks a frame.
 */
export type Sound =
  | 'jump' | 'swing' | 'throw' | 'hit' | 'hurt' | 'block' | 'clang' | 'break'
  | 'crow' | 'coin' | 'chest' | 'bell' | 'boss' | 'slam' | 'rescue' | 'burst' | 'special'

interface Note { frequency: number; to: number; seconds: number; type: OscillatorType; gain: number; delay?: number }

const NOTES: Record<Sound, readonly Note[]> = {
  crow: [{ frequency: 340, to: 105, seconds: 0.18, type: 'sawtooth', gain: 0.04 }, { frequency: 280, to: 110, seconds: 0.2, type: 'sawtooth', gain: 0.035, delay: 0.24 }],
  jump: [{ frequency: 300, to: 440, seconds: 0.08, type: 'square', gain: 0.05 }],
  swing: [{ frequency: 420, to: 180, seconds: 0.09, type: 'sawtooth', gain: 0.04 }],
  throw: [{ frequency: 520, to: 300, seconds: 0.07, type: 'triangle', gain: 0.04 }],
  hit: [{ frequency: 190, to: 90, seconds: 0.1, type: 'sawtooth', gain: 0.07 }],
  hurt: [{ frequency: 220, to: 70, seconds: 0.26, type: 'square', gain: 0.08 }],
  block: [
    { frequency: 880, to: 760, seconds: 0.09, type: 'square', gain: 0.05 },
    { frequency: 1320, to: 1100, seconds: 0.07, type: 'triangle', gain: 0.04 },
  ],
  clang: [
    { frequency: 1400, to: 500, seconds: 0.22, type: 'sawtooth', gain: 0.06 },
    { frequency: 300, to: 120, seconds: 0.18, type: 'square', gain: 0.05, delay: 0.02 },
  ],
  break: [{ frequency: 1200, to: 90, seconds: 0.3, type: 'sawtooth', gain: 0.07 }],
  coin: [{ frequency: 980, to: 1480, seconds: 0.08, type: 'sine', gain: 0.05 }],
  chest: [
    { frequency: 520, to: 660, seconds: 0.1, type: 'triangle', gain: 0.05 },
    { frequency: 780, to: 990, seconds: 0.12, type: 'triangle', gain: 0.05, delay: 0.08 },
  ],
  bell: [
    { frequency: 196, to: 190, seconds: 1.4, type: 'sine', gain: 0.09 },
    { frequency: 392, to: 380, seconds: 1.1, type: 'sine', gain: 0.04 },
    { frequency: 583, to: 560, seconds: 0.8, type: 'sine', gain: 0.02 },
  ],
  boss: [
    { frequency: 90, to: 60, seconds: 0.8, type: 'sawtooth', gain: 0.07 },
    { frequency: 135, to: 90, seconds: 0.6, type: 'square', gain: 0.03, delay: 0.1 },
  ],
  slam: [
    { frequency: 120, to: 40, seconds: 0.4, type: 'square', gain: 0.08 },
    { frequency: 300, to: 60, seconds: 0.25, type: 'sawtooth', gain: 0.05, delay: 0.02 },
  ],
  rescue: [
    { frequency: 680, to: 430, seconds: 0.75, type: 'sawtooth', gain: 0.035 },
    { frequency: 1360, to: 860, seconds: 0.7, type: 'sine', gain: 0.02 },
    { frequency: 590, to: 360, seconds: 0.5, type: 'sawtooth', gain: 0.025, delay: 0.85 },
  ],
  burst: [{ frequency: 260, to: 40, seconds: 0.3, type: 'sawtooth', gain: 0.08 }],
  special: [
    { frequency: 180, to: 900, seconds: 0.25, type: 'sawtooth', gain: 0.05 },
    { frequency: 900, to: 120, seconds: 0.3, type: 'square', gain: 0.04, delay: 0.1 },
  ],
}

const MUTE_KEY = 'adomnia.hub.muted'
let context: AudioContext | null = null
let muted = false

export function loadMuted(): boolean {
  try { muted = localStorage.getItem(MUTE_KEY) === '1' } catch { muted = false }
  return muted
}
export function toggleMuted(): boolean {
  muted = !muted
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0') } catch { /* the preference is only a nicety */ }
  return muted
}

/** Called from the Play button: some browsers only allow audio after a user gesture. */
export function unlockAudio(): void {
  const audio = ensure()
  if (audio?.state === 'suspended') void audio.resume()
}

function ensure(): AudioContext | null {
  try {
    context ??= new AudioContext()
    return context
  } catch {
    return null
  }
}

/** Plays one cue. Silently does nothing when muted, unavailable or during server rendering. */
export function playSound(sound: Sound): void {
  if (muted) return
  const audio = ensure()
  if (!audio) return
  const start = audio.currentTime
  for (const note of NOTES[sound]) {
    const at = start + (note.delay ?? 0)
    try {
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.type = note.type
      oscillator.frequency.setValueAtTime(note.frequency, at)
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, note.to), at + note.seconds)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(note.gain, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + note.seconds)
      oscillator.connect(gain).connect(audio.destination)
      if (sound === 'rescue') {
        const tremble = audio.createOscillator()
        const depth = audio.createGain()
        tremble.frequency.value = 11
        depth.gain.value = 32
        tremble.connect(depth).connect(oscillator.frequency)
        tremble.start(at)
        tremble.stop(at + note.seconds + 0.02)
      }
      oscillator.start(at)
      oscillator.stop(at + note.seconds + 0.02)
    } catch {
      return
    }
  }
}
