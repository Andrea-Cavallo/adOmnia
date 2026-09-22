import { afterEach, expect, it, vi } from 'vitest'
import { loadPreferences, savePreferences } from './preferences'

afterEach(() => vi.unstubAllGlobals())
it('migrates accessibility preferences without comparing old Localhost records to a campaign', () => {
  const values = new Map([['adomnia.bughunt.preferences.v1', JSON.stringify({audio:false,reducedMotion:true,bestSeconds:25,bestBits:37})]])
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  expect(loadPreferences()).toEqual({ audio:false,reducedMotion:true,bestSeconds:null,bestBits:0,bestScore:0 })
  savePreferences({ audio:false,reducedMotion:true,bestSeconds:130,bestBits:70,bestScore:2400 })
  values.set('adomnia.bughunt.preferences.v1', 'invalid old data')
  expect(loadPreferences().bestSeconds).toBe(130)
  expect(loadPreferences().bestScore).toBe(2400)
})
it('still runs when local storage is unavailable', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled') }, setItem: () => { throw new Error('full') } })
  expect(loadPreferences().bestSeconds).toBeNull()
  expect(() => savePreferences(loadPreferences())).not.toThrow()
})

it.each(['arcade.v3', 'three-lives.v4'])('keeps %s accessibility settings but starts separate developer-world records', (version) => {
  const previous = JSON.stringify({ audio: false, reducedMotion: true, bestSeconds: 20, bestBits: 135, bestScore: 9000 })
  const values = new Map([[`adomnia.bughunt.preferences.${version}`, previous]])
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
  expect(loadPreferences()).toEqual({ audio: false, reducedMotion: true, bestSeconds: null, bestBits: 0, bestScore: 0 })
  savePreferences(loadPreferences())
  expect(values.get(`adomnia.bughunt.preferences.${version}`)).toBe(previous)
})
