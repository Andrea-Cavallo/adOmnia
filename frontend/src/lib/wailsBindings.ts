export function getWailsMainBinding<T>(name: string): T {
  const binding = window.go?.main?.[name as keyof WailsGoMain] as T | undefined
  if (!binding) {
    throw new Error(`${name} is available only in the desktop app.`)
  }
  return binding
}

export function hasWailsMainBinding(name: string): boolean {
  return Boolean(window.go?.main?.[name as keyof WailsGoMain])
}
