export type Sound = 'jump' | 'land' | 'bit' | 'stomp' | 'hurt' | 'checkpoint' | 'hotfix' | 'win' | 'secret' | 'dash' | 'spring' | 'combo'
  | 'power' | 'freeze' | 'sudo' | 'gc' | 'rewind' | 'shoot' | 'bolt' | 'hit' | 'arenaTell'

// Small original arcade sounds, synthesised locally. No samples, requests,
// autoplay or background music process; the context belongs to this session.
export class BugHuntAudio {
  private context: AudioContext | null = null
  private active = new Set<OscillatorNode>()
  enabled = true

  unlock() {
    if (!this.enabled) return
    try {
      this.context ??= new AudioContext()
      if (this.context.state === 'suspended') void this.context.resume().catch(() => undefined)
    } catch { /* audio is optional on runtimes without Web Audio */ }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled
    if (enabled) this.unlock()
    else this.stop()
  }

  private note(frequency: number, end: number, duration: number, delay = 0, type: OscillatorType = 'sine', volume = 0.055) {
    const ctx = this.context
    if (!this.enabled || !ctx || ctx.state !== 'running' || this.active.size > 20) return
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    const start = ctx.currentTime + delay
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, start)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, end), start + duration)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(volume, start + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    this.active.add(oscillator)
    oscillator.onended = () => { this.active.delete(oscillator); oscillator.disconnect(); gain.disconnect() }
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
  }

  play(sound: Sound, variation = 0) {
    switch (sound) {
      case 'arenaTell': this.note(440, 440, .12, 0, 'triangle', .05); this.note(660, 660, .16, .18, 'triangle', .05); break
      case 'dash': this.note(720, 95, 0.16, 0, 'sawtooth', 0.026); break
      case 'shoot': this.note(1250, 420, 0.07, 0, 'square', 0.02); this.note(520, 260, 0.05, 0.01, 'triangle', 0.016); break
      case 'bolt': this.note(300, 190, 0.12, 0, 'sawtooth', 0.018); break
      case 'hit': this.note(220, 520, 0.06, 0, 'square', 0.022); break
      case 'power': [440, 660, 880].forEach((pitch, i) => this.note(pitch, pitch * 1.5, 0.12, i * 0.05, 'triangle')); break
      case 'freeze': this.note(1320, 1320, 0.06, 0, 'square', 0.03); this.note(990, 990, 0.09, 0.09, 'square', 0.03); break
      case 'sudo': [330, 415, 494, 659].forEach((pitch, i) => this.note(pitch, pitch, 0.3, i * 0.04, 'square', 0.022)); break
      case 'gc': this.note(1400, 55, 0.45, 0, 'triangle', 0.06); this.note(90, 40, 0.3, 0.05, 'sine', 0.08); break
      case 'rewind': this.note(900, 140, 0.35, 0, 'sawtooth', 0.025); this.note(140, 900, 0.25, 0.35, 'triangle', 0.035); break
      case 'spring': this.note(170, 1100, 0.25, 0, 'triangle'); break
      case 'combo': this.note(660 + variation * 100, 1400, 0.15); this.note(990, 1600, 0.18, 0.07); break
      case 'jump': this.note(240, 560, 0.13, 0, 'triangle'); break
      case 'land': this.note(110, 65, 0.07, 0, 'sine', 0.035); break
      case 'bit': {
        const pitch = [660, 740, 880, 990, 1175][variation % 5]
        this.note(pitch, pitch * 1.35, 0.11)
        break
      }
      case 'stomp': this.note(180, 80, 0.11, 0, 'triangle'); this.note(580, 870, 0.1, 0.06); break
      case 'hurt': this.note(220, 60, 0.23, 0, 'triangle', 0.07); break
      case 'checkpoint':
      case 'hotfix':
      case 'secret':
      case 'win': {
        const notes = sound === 'win' ? [523, 659, 784, 1047, 1318] : [523, 659, 1047]
        notes.forEach((pitch, i) => this.note(pitch, pitch, 0.22, i * 0.075, 'triangle'))
        break
      }
    }
  }

  stop() {
    for (const oscillator of this.active) {
      try { oscillator.stop() } catch { /* already ended */ }
    }
    this.active.clear()
  }

  destroy() {
    this.stop()
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = null
  }
}
