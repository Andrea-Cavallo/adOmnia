import * as MilkBindings from '../../bindings/adomnia/milk'
import { Events } from '@wailsio/runtime'
import type {
  PromptRequest,
  PromptResponse,
  Settings,
  Status,
} from '../../bindings/adomnia/internal/milk/models'

export type MilkStatus = Status
export type MilkSettings = Settings
export type MilkPromptRequest = PromptRequest
export type MilkPromptResponse = PromptResponse

export interface MilkToolUpdate {
  toolCallId: string
  name: string
  status: string
  rawOutput?: string
}

export interface MilkRouteInfo {
  agent: string
  target: string
  reason: string
}

export interface MilkChatEvent {
  token: string
  root: string
  sessionId?: string
  kind: 'begin' | 'text' | 'thought' | 'tool' | 'end' | 'route' | 'warning' | 'error'
  reply?: string
  tool?: MilkToolUpdate
  route?: MilkRouteInfo
  error?: string
  stopReason?: string
}

export interface MilkPermissionOption {
  optionId: string
  name?: string
  kind?: string
}

export interface MilkPermissionEvent {
  requestId: string
  sessionId: string
  toolCallId: string
  title: string
  description: string
  options: MilkPermissionOption[]
}

export const getMilkStatus = (): Promise<MilkStatus> => MilkBindings.Status()
export const getMilkSettings = (): Promise<MilkSettings> => MilkBindings.Settings()
export const saveMilkSettings = (settings: MilkSettings): Promise<MilkSettings> => MilkBindings.SaveSettings(settings)
export const installMilk = (): Promise<MilkStatus> => MilkBindings.Install()
export const restartMilk = (): Promise<void> => MilkBindings.Restart()
export const getMilkLog = (): Promise<string[]> => MilkBindings.Log()
export const setMilkWorkspace = (root: string): Promise<void> => MilkBindings.SetActiveWorkspace(root)
export const sendMilkPrompt = (request: MilkPromptRequest): Promise<MilkPromptResponse> => MilkBindings.Prompt(request)
export const cancelMilkPrompt = (token: string): Promise<void> => MilkBindings.CancelPrompt(token)
export const resetMilkSession = (root: string): Promise<void> => MilkBindings.ResetSession(root)
export const cancelMilkSession = (sessionId: string): Promise<void> => MilkBindings.CancelSession(sessionId)
export const respondMilkPermission = (requestId: string, allow: boolean): Promise<void> => MilkBindings.RespondPermission(requestId, allow)

export function subscribeMilkEvents(handlers: {
  status: (status: MilkStatus) => void
  chat: (event: MilkChatEvent) => void
  permission: (event: MilkPermissionEvent) => void
  /** The backend answered, timed out or dropped the request. */
  permissionResolved: (requestId: string) => void
}): () => void {
  const offs = [
    Events.On('milk.status', (event) => handlers.status(event.data as MilkStatus)),
    Events.On('milk.chat', (event) => handlers.chat(event.data as MilkChatEvent)),
    Events.On('milk.permission', (event) => handlers.permission(event.data as MilkPermissionEvent)),
    Events.On('milk.permissionResolved', (event) => handlers.permissionResolved((event.data as { requestId: string }).requestId)),
  ]
  return () => offs.forEach((off) => off())
}
