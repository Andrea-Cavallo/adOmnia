// Compatibility import path retained while the generated Wails v3 bindings
// live under frontend/bindings.
export * from '../../../../bindings/adomnia/app'

export interface StorageEntry {
  bucket: string
  key: string
  value: string
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  releaseUrl: string
  releaseNotes: string
  publishedAt: string
  isDev: boolean
}
