import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Cpu, Diamond, Flag, Pause, Play, RotateCcw, Sparkles, Trophy, Volume2, VolumeX, X } from 'lucide-react'
import { BugHuntPrototype, HEIGHT, INITIAL_SNAPSHOT, WIDTH, type GameSnapshot } from './prototype'
import { formatTime, loadPreferences, savePreferences, type BugHuntPreferences } from './preferences'
import { BUG_HUNT_COPY } from './copy'
import { useSettingsStore } from '@/stores/settings'
import type { Lang } from '@/lib/i18n'
import './bughunt.css'

const CONTROL_KEYS = new Set(['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space'])

export function BugHuntOverlay({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const gameRef = useRef<BugHuntPrototype | null>(null)
  const closeRef = useRef(onClose)
  const [snapshot, setSnapshot] = useState<GameSnapshot>(INITIAL_SNAPSHOT)
  const snapshotRef = useRef(snapshot)
  const [ready, setReady] = useState(true)
  const readyRef = useRef(true)
  const [preferences, setPreferences] = useState(loadPreferences)
  const preferencesRef = useRef(preferences)
  const [newRecord, setNewRecord] = useState(false)
  const resultSaved = useRef(false)
  closeRef.current = onClose
  const language = useSettingsStore((state) => state.settings.appearance.language ?? 'en') as Lang
  const copy = BUG_HUNT_COPY[language] ?? BUG_HUNT_COPY.en
  const copyRef = useRef(copy)
  copyRef.current = copy

  useEffect(() => {
    if (!canvasRef.current) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const game = new BugHuntPrototype(canvasRef.current, (next) => { snapshotRef.current = next; setSnapshot(next) }, { ...preferencesRef.current, copy: copyRef.current })
    gameRef.current = game
    game.setPaused(true)
    primaryRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Tab') {
        const buttons = Array.from(overlayRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).filter((button) => button.offsetParent !== null)
        if (!buttons.length) return
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        if (event.shiftKey && index <= 0) { event.preventDefault(); buttons[buttons.length - 1].focus() }
        else if (!event.shiftKey && (index === -1 || index === buttons.length - 1)) { event.preventDefault(); buttons[0].focus() }
        return
      }
      if (event.code === 'Escape') {
        event.stopImmediatePropagation(); event.preventDefault()
        if (event.repeat) return
        if (readyRef.current || snapshotRef.current.finished) closeRef.current()
        else game.setPaused(!snapshotRef.current.paused)
        return
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        event.stopImmediatePropagation(); event.preventDefault(); return
      }
      const playing = !readyRef.current && !snapshotRef.current.paused && !snapshotRef.current.finished
      if (playing && CONTROL_KEYS.has(event.code)) {
        event.stopImmediatePropagation(); event.preventDefault()
        if (!event.repeat) game.keyDown(event.code)
      } else if (event.code.startsWith('Arrow')) {
        // Keep adOmnia's global spatial navigation out of the game menus.
        event.stopImmediatePropagation(); event.preventDefault()
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      game.keyUp(event.code)
      if (!readyRef.current && !snapshotRef.current.paused && !snapshotRef.current.finished && CONTROL_KEYS.has(event.code)) {
        event.stopImmediatePropagation(); event.preventDefault()
      }
    }
    const pause = () => game.setPaused(true)
    const visibility = () => { if (document.hidden) pause() }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', pause)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', pause)
      document.removeEventListener('visibilitychange', visibility)
      game.destroy(); gameRef.current = null
      if (previouslyFocused?.isConnected) previouslyFocused.focus()
    }
  }, [])

  useEffect(() => { gameRef.current?.setCopy(copy) }, [copy])

  useEffect(() => {
    if (ready || snapshot.paused || snapshot.finished) primaryRef.current?.focus()
    else overlayRef.current?.focus()
  }, [ready, snapshot.paused, snapshot.finished])

  useEffect(() => {
    if (!snapshot.finished || resultSaved.current) return
    resultSaved.current = true
    const current = preferencesRef.current
    const improved = current.bestSeconds === null || snapshot.seconds < current.bestSeconds
    const next = { ...current, bestSeconds: improved ? snapshot.seconds : current.bestSeconds, bestBits: Math.max(current.bestBits, snapshot.bits) }
    preferencesRef.current = next; setPreferences(next); savePreferences(next); setNewRecord(improved)
  }, [snapshot.finished, snapshot.seconds, snapshot.bits])

  const updatePreferences = (update: Partial<BugHuntPreferences>) => {
    const next = { ...preferencesRef.current, ...update }
    preferencesRef.current = next; setPreferences(next); savePreferences(next)
    gameRef.current?.setAudio(next.audio)
    gameRef.current?.setReducedMotion(next.reducedMotion)
  }
  const begin = () => {
    readyRef.current = false; setReady(false)
    gameRef.current?.unlockAudio(); gameRef.current?.setPaused(false)
  }
  const restart = () => {
    resultSaved.current = false; setNewRecord(false)
    gameRef.current?.unlockAudio(); gameRef.current?.restart()
    overlayRef.current?.focus()
  }
  const resume = () => { gameRef.current?.unlockAudio(); gameRef.current?.setPaused(false) }

  return (
    <div ref={overlayRef} tabIndex={-1} className="bug-hunt" role="dialog" aria-modal="true" aria-label={copy.dialogLabel} data-bug-hunt onMouseDown={(event) => event.stopPropagation()}>
      <header className="bh-header">
        <div className="bh-brand"><span className="bh-brand-mark" aria-hidden>aO</span><div><strong>BUG HUNT</strong><small>{copy.brandSubtitle}</small></div></div>
        <div className="bh-header-actions">
          <button className="bh-icon-button" aria-label={preferences.audio ? copy.audioOn : copy.audioOff} title={preferences.audio ? copy.audioOn : copy.audioOff} aria-pressed={preferences.audio} onClick={() => updatePreferences({ audio: !preferences.audio })}>{preferences.audio ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
          <button className="bh-icon-button" aria-label={copy.gentle} title={copy.gentleTitle} aria-pressed={preferences.reducedMotion} onClick={() => updatePreferences({ reducedMotion: !preferences.reducedMotion })}><Sparkles size={16} /></button>
          {!ready && !snapshot.finished && <button className="bh-icon-button" aria-label={snapshot.paused ? copy.resume : copy.pause} title={copy.pauseTitle} onClick={() => snapshot.paused ? resume() : gameRef.current?.setPaused(true)}>{snapshot.paused ? <Play size={15} /> : <Pause size={15} />}</button>}
          <button className="bh-icon-button" aria-label={copy.backToApp} title={copy.backToApp} onClick={() => closeRef.current()}><X size={17} /></button>
        </div>
      </header>
      <div className="bh-stage">
        <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} aria-label={copy.canvasLabel} />
        {!ready && <div className="bh-hud" aria-label={copy.hudLabel}>
          <div className="bh-hud-group"><span className="bh-pill" aria-label={copy.healthLabel(snapshot.health)}><span className="bh-heart">{'♥'.repeat(snapshot.health)}<span className="bh-heart-empty">{'♥'.repeat(3 - snapshot.health)}</span></span></span><span className="bh-pill gold"><Diamond size={13} /><strong>{snapshot.bits}</strong><span>/ {snapshot.totalBits}</span></span></div>
          <div className="bh-hud-group"><span className={`bh-pill ${snapshot.hotfix ? 'mint' : ''}`}><Cpu size={14} />{snapshot.hotfix ? copy.hotfixFound : copy.findHotfix}</span><span className="bh-pill">{formatTime(snapshot.seconds)}</span></div>
        </div>}
        {(ready || snapshot.paused || snapshot.finished) && <div className="bh-modal">
          <div className="bh-card">
            <div className="bh-eyebrow"><span className="bh-dot" />{ready ? copy.introEyebrow : snapshot.finished ? copy.winEyebrow : copy.pauseEyebrow}</div>
            {ready ? <>
              <h1>{copy.introTitle}<em>{copy.introTitleAccent}</em></h1>
              <p className="bh-quote">{copy.introQuote}</p>
              <p>{copy.introBody}</p>
              <div className="bh-mission"><Cpu size={21} /><div><strong>{copy.missionTitle}</strong><span>{copy.missionBody}</span></div></div>
              <div className="bh-card-actions"><button ref={primaryRef} className="bh-primary" onClick={begin}>{copy.start} <ArrowRight size={15} /></button></div>
              <p className="bh-tip">{copy.introTip}{preferences.bestSeconds !== null && copy.record(formatTime(preferences.bestSeconds))}</p>
            </> : snapshot.finished ? <>
              <h1>{copy.winTitle}<em>{copy.winTitleAccent}</em></h1>
              <p>{copy.winBody}</p>
              <div className="bh-stats"><div className="bh-stat"><strong>{formatTime(snapshot.seconds)}</strong><span>{copy.statTime}</span></div><div className="bh-stat"><strong>{snapshot.bits}/{snapshot.totalBits}</strong><span>{copy.statBits}</span></div><div className="bh-stat"><strong>{snapshot.deaths}</strong><span>{copy.statDeaths}</span></div></div>
              {newRecord && <span className="bh-medal"><Trophy size={12} />{copy.medalRecord}</span>}
              {snapshot.secret && <span className="bh-medal"><Sparkles size={12} />{copy.medalSecret}</span>}
              {snapshot.bugs === 3 && <span className="bh-medal"><Check size={12} />{copy.medalBugs}</span>}
              <p className="bh-quote">{copy.winQuote}</p>
              <div className="bh-card-actions"><button ref={primaryRef} className="bh-primary" onClick={restart}><RotateCcw size={14} />{copy.playAgain}</button><button className="bh-secondary" onClick={() => closeRef.current()}>{copy.backToWork}</button></div>
            </> : <>
              <h1>{copy.pauseTitle1}<em>{copy.pauseTitle2}</em></h1>
              <p>{snapshot.checkpoint ? copy.pauseBodyCheckpoint : copy.pauseBody}</p>
              <div className="bh-card-actions"><button ref={primaryRef} className="bh-primary" onClick={resume}><Play size={14} />{copy.resume}</button><button className="bh-secondary" onClick={restart}><RotateCcw size={14} />{copy.restart}</button><button className="bh-secondary" onClick={() => closeRef.current()}>{copy.exit}</button></div>
              <p className="bh-tip">{copy.pauseTip}</p>
            </>}
          </div>
        </div>}
      </div>
      <footer className="bh-footer"><div className="bh-keys"><span><kbd>A</kbd> <kbd>D</kbd> / <kbd>←</kbd> <kbd>→</kbd> {copy.keysMove}</span><span><kbd>{copy.keySpace}</kbd> {copy.keysJump}</span><span><kbd>Esc</kbd> {copy.keysPause}</span></div><span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Flag size={11} />{snapshot.checkpoint ? copy.checkpointSaved : copy.findCheckpoint}</span></footer>
    </div>
  )
}
