// Compatibility layer for the former Wails v2 runtime imports. New code uses
// @wailsio/runtime directly; existing UI modules retain their stable imports.
import { Application, Browser, Clipboard, Events, System, Window } from '@wailsio/runtime'

export const WindowMinimise = () => Window.Minimise()
export const WindowMaximise = () => Window.Maximise()
export const WindowToggleMaximise = () => Window.ToggleMaximise()
export const WindowUnmaximise = () => Window.UnMaximise()
export const WindowFullscreen = () => Window.Fullscreen()
export const WindowUnfullscreen = () => Window.UnFullscreen()
export const WindowSetSize = (width, height) => Window.SetSize(width, height)
export const WindowGetSize = async () => {
  const { width: w, height: h } = await Window.Size()
  return { w, h }
}
export const WindowSetPosition = (x, y) => Window.SetPosition(x, y)
export const WindowGetPosition = () => Window.Position()
export const WindowHide = () => Window.Hide()
export const WindowShow = () => Window.Show()
export const WindowCenter = () => Window.Center()
export const WindowSetTitle = (title) => Window.SetTitle(title)
export const Quit = () => Application.Quit()
export const Environment = async () => {
  const env = await System.Environment()
  return { buildType: env.Debug ? 'debug' : 'production', platform: env.OS, arch: env.Arch }
}
export const EventsOn = (eventName, callback) => Events.On(eventName, (event) => callback(event.data))
export const EventsOnce = (eventName, callback) => Events.Once(eventName, (event) => callback(event.data))
export const EventsOnMultiple = (eventName, callback, maxCallbacks) => Events.OnMultiple(eventName, (event) => callback(event.data), maxCallbacks)
export const EventsEmit = (eventName, ...data) => Events.Emit(eventName, data.length <= 1 ? data[0] : data)
export const EventsOff = (eventName, ...additionalEventNames) => Events.Off(eventName, ...additionalEventNames)
export const LogDebug = (message) => console.debug(message)
export const LogInfo = (message) => console.info(message)
export const LogWarning = (message) => console.warn(message)
export const LogError = (message) => console.error(message)
export const LogFatal = (message) => console.error(message)
export const BrowserOpenURL = (url) => Browser.OpenURL(url)
export const ClipboardGetText = () => Clipboard.Text()
export const ClipboardSetText = (text) => Clipboard.SetText(text).then(() => true)
