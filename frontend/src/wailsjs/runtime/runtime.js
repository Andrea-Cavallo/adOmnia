export function WindowMinimise() { window.runtime?.WindowMinimise(); }
export function WindowMaximise() { window.runtime?.WindowMaximise(); }
export function WindowToggleMaximise() { window.runtime?.WindowToggleMaximise(); }
export function WindowUnmaximise() { window.runtime?.WindowUnmaximise(); }
export function WindowFullscreen() { window.runtime?.WindowFullscreen(); }
export function WindowUnfullscreen() { window.runtime?.WindowUnfullscreen(); }
export function WindowSetSize(width, height) { window.runtime?.WindowSetSize(width, height); }
export function WindowGetSize() { return window.runtime?.WindowGetSize(); }
export function WindowSetPosition(x, y) { window.runtime?.WindowSetPosition(x, y); }
export function WindowGetPosition() { return window.runtime?.WindowGetPosition(); }
export function WindowHide() { window.runtime?.WindowHide(); }
export function WindowShow() { window.runtime?.WindowShow(); }
export function WindowCenter() { window.runtime?.WindowCenter(); }
export function WindowSetTitle(title) { window.runtime?.WindowSetTitle(title); }
export function Quit() { window.runtime?.Quit(); }
export function Environment() { return window.runtime?.Environment(); }
export function EventsOn(eventName, callback) { return window.runtime?.EventsOn(eventName, callback); }
export function EventsOnce(eventName, callback) { return window.runtime?.EventsOnce(eventName, callback); }
export function EventsOnMultiple(eventName, callback, maxCallbacks) { return window.runtime?.EventsOnMultiple(eventName, callback, maxCallbacks); }
export function EventsEmit(eventName, ...data) { window.runtime?.EventsEmit(eventName, ...data); }
export function EventsOff(eventName, ...additionalEventNames) { window.runtime?.EventsOff(eventName, ...additionalEventNames); }
export function LogDebug(message) { window.runtime?.LogDebug(message); }
export function LogInfo(message) { window.runtime?.LogInfo(message); }
export function LogWarning(message) { window.runtime?.LogWarning(message); }
export function LogError(message) { window.runtime?.LogError(message); }
export function LogFatal(message) { window.runtime?.LogFatal(message); }
export function BrowserOpenURL(url) { window.runtime?.BrowserOpenURL(url); }
export function ClipboardGetText() { return window.runtime?.ClipboardGetText(); }
export function ClipboardSetText(text) { return window.runtime?.ClipboardSetText(text); }
