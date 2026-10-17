import * as GoIDEBindings from '../../bindings/adomnia/goide'
import type { PreviewConfig, PreviewRequest, WebProjectReport, Execution } from '../../bindings/adomnia/internal/codestudio/models'
import type { Preview } from '../../bindings/adomnia/internal/ide/preview/models'
import type { Info as WebProjectInfo, Runtime as WebRuntime } from '../../bindings/adomnia/internal/languages/web/models'

export type LivePreview = Preview
export type LivePreviewConfig = PreviewConfig
export type LivePreviewRequest = PreviewRequest
export type LivePreviewReport = WebProjectReport
export type LivePreviewTarget = WebProjectInfo
export type LivePreviewRuntime = WebRuntime
export type LivePreviewExecution = Execution

/** Riconosce progetti web, runtime Node.js e language server. Non esegue nulla. */
export function detectWebProject(sessionId: string): Promise<LivePreviewReport> {
  return GoIDEBindings.DetectWebProject(sessionId)
}

export function startPreview(sessionId: string, request: LivePreviewRequest): Promise<LivePreview> {
  return GoIDEBindings.StartPreview(sessionId, request)
}

export function stopPreview(sessionId: string, previewId: string): Promise<void> {
  return GoIDEBindings.StopPreview(sessionId, previewId)
}

export function listPreviews(sessionId: string): Promise<LivePreview[]> {
  return GoIDEBindings.ListPreviews(sessionId)
}

export function dismissPreviews(sessionId: string): Promise<void> {
  return GoIDEBindings.DismissPreviews(sessionId)
}

export function savePreviewConfig(sessionId: string, config: LivePreviewConfig): Promise<void> {
  return GoIDEBindings.SavePreviewConfig(sessionId, config)
}

export function installWebDependencies(sessionId: string, dir: string): Promise<LivePreviewExecution> {
  return GoIDEBindings.InstallWebDependencies(sessionId, dir, true)
}

export function openPreviewWindow(sessionId: string, previewId: string, title: string): Promise<void> {
  return GoIDEBindings.OpenPreviewWindow(sessionId, previewId, title)
}

export function readyPreviewUrl(sessionId: string, previewId: string): Promise<string> {
  return GoIDEBindings.ReadyPreviewURL(sessionId, previewId)
}
