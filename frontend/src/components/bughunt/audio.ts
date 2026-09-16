export type Sound = 'jump' | 'land' | 'bit' | 'stomp' | 'hurt' | 'checkpoint' | 'hotfix' | 'win' | 'secret'

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
