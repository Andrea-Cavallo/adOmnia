export function LoadSettings(): Promise<string> {
  return window['go']['main']['App']['LoadSettings']()
}

export function SaveSettings(settingsJSON: string): Promise<void> {
  return window['go']['main']['App']['SaveSettings'](settingsJSON)
}

export function ClearDevLogs(): Promise<void> {
  return window['go']['main']['App']['ClearDevLogs']()
}

export function GetDevLogs(): Promise<string> {
  return window['go']['main']['App']['GetDevLogs']()
}

export function GetServerPort(): Promise<number> {
  return window['go']['main']['App']['GetServerPort']()
}

export function GetStartupWindowChrome(): Promise<string> {
  return window['go']['main']['App']['GetStartupWindowChrome']()
}

export function GetSidecarToken(): Promise<string> {
  return (window['go']['main']['App'] as unknown as Record<string, () => Promise<string>>)['GetSidecarToken']()
}

export function ExecuteHTTP(reqJSON: string): Promise<string> {
  return (window['go']['main']['App'] as unknown as Record<string, (a: string) => Promise<string>>)['ExecuteHTTP'](reqJSON)
}

export function CompareFolders(left: string, right: string, maxFileMB: number): Promise<string> {
  return (window['go']['main']['App'] as unknown as Record<string, (a: string, b: string, c: number) => Promise<string>>)['CompareFolders'](left, right, maxFileMB)
}

export function ReadFolderDiffFile(scanID: string, path: string, maxBytes: number): Promise<string> {
  return (window['go']['main']['App'] as unknown as Record<string, (a: string, b: string, c: number) => Promise<string>>)['ReadFolderDiffFile'](scanID, path, maxBytes)
}

export function SelectFolder(title: string): Promise<string> {
  return window['go']['main']['App']['SelectFolder'](title)
}

export function IsDevMode(): Promise<boolean> {
  return window['go']['main']['App']['IsDevMode']()
}

export function SetDevMode(enabled: boolean): Promise<void> {
  return window['go']['main']['App']['SetDevMode'](enabled)
}

export function OpenDevLogsFolder(): Promise<void> {
  return window['go']['main']['App']['OpenDevLogsFolder']()
}

export function GetVaultTimeout(): Promise<number> {
  return window['go']['main']['App']['GetVaultTimeout']()
}

export function SetVaultTimeout(minutes: number): Promise<void> {
  return window['go']['main']['App']['SetVaultTimeout'](minutes)
}

export function StorageGet(bucket: string, key: string): Promise<string> {
  return window['go']['main']['App']['StorageGet'](bucket, key)
}

export function StoragePut(bucket: string, key: string, value: string): Promise<void> {
  return window['go']['main']['App']['StoragePut'](bucket, key, value)
}

export function StorageDelete(bucket: string, key: string): Promise<void> {
  return window['go']['main']['App']['StorageDelete'](bucket, key)
}

export function StorageList(bucket: string, prefix: string): Promise<string[]> {
  return window['go']['main']['App']['StorageList'](bucket, prefix)
}

export interface StorageEntry {
  bucket: string
  key: string
  value: string
}

export function StorageGetAll(bucket: string): Promise<StorageEntry[]> {
  return window['go']['main']['App']['StorageGetAll'](bucket)
}
