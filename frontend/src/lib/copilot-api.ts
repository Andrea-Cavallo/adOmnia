import * as CopilotBindings from '../../bindings/adomnia/copilot'
import { Events } from '@wailsio/runtime'
import type {
  GitHubProfile,
  ChatRequest,
  ChatResponse,
  ChatSelection,
  InlineCompletionItem,
  InlineCompletionRequest,
  ServerBinary,
  Settings,
  SignInPrompt,
  Status,
} from '../../bindings/adomnia/internal/copilot/models'
import type { CancellablePromise } from '@wailsio/runtime'

export type CopilotProfile = GitHubProfile
export type CopilotSettings = Settings
export type CopilotStatus = Status
export type CopilotSignInPrompt = SignInPrompt
export type CopilotServerBinary = ServerBinary
export type CopilotInlineItem = InlineCompletionItem
export type CopilotInlineRequest = InlineCompletionRequest
export type CopilotChatRequest = ChatRequest
export type CopilotChatResponse = ChatResponse
export type CopilotChatSelection = ChatSelection

export interface CopilotInstallProgress {
  version: string
  downloaded: number
  total: number
}

export interface CopilotMessage {
  type: number
  message: string
  actions?: string[]
}

export interface CopilotChatEvent {
  token: string
  kind: 'begin' | 'report' | 'end'
  reply?: string
  conversationId?: string
  turnId?: string
  title?: string
  error?: string
}

export const getCopilotStatus = (): Promise<CopilotStatus> => CopilotBindings.Status()
export const getCopilotSettings = (): Promise<CopilotSettings> => CopilotBindings.Settings()
export const saveCopilotSettings = (settings: CopilotSettings): Promise<CopilotSettings> => CopilotBindings.SaveSettings(settings)
export const installCopilotServer = (): Promise<CopilotServerBinary> => CopilotBindings.Install()
export const restartCopilot = (): Promise<void> => CopilotBindings.Restart()
export const getCopilotLog = (): Promise<string[]> => CopilotBindings.Log()
export const copilotSignIn = (): Promise<CopilotSignInPrompt> => CopilotBindings.SignIn()
export const copilotSignOut = (): Promise<void> => CopilotBindings.SignOut()
export const setCopilotWorkspace = (root: string): Promise<void> => CopilotBindings.SetActiveWorkspace(root)
export const focusCopilotDocument = (documentId: string): Promise<void> => CopilotBindings.FocusDocument(documentId)
export const sendCopilotChat = (request: CopilotChatRequest): CancellablePromise<CopilotChatResponse> => CopilotBindings.Chat(request)
export const cancelCopilotChat = (token: string): Promise<boolean> => CopilotBindings.CancelChat(token)
export const destroyCopilotChat = (conversationId: string): Promise<void> => CopilotBindings.DestroyChat(conversationId)

/** Cancellabile: annullarla invia $/cancelRequest al Language Server, niente ghost text obsoleto. */
export const requestCopilotCompletion = (request: CopilotInlineRequest): CancellablePromise<CopilotInlineItem[]> =>
  CopilotBindings.InlineCompletion(request)

// L'item grezzo torna al server così com'è: serve alla telemetria di visualizzazione e accettazione.
export const didShowCopilotCompletion = (raw: unknown): Promise<void> => CopilotBindings.DidShowCompletion(raw as never)
export const didAcceptCopilotCompletion = (raw: unknown): Promise<void> => CopilotBindings.DidAcceptCompletion(raw as never)
export const didPartiallyAcceptCopilotCompletion = (raw: unknown, acceptedLength: number): Promise<void> =>
  CopilotBindings.DidPartiallyAcceptCompletion(raw as never, acceptedLength)

export function subscribeCopilotEvents(handlers: {
  status: (status: CopilotStatus) => void
  install: (progress: CopilotInstallProgress) => void
  message: (message: CopilotMessage) => void
  chat: (event: CopilotChatEvent) => void
}): () => void {
  const offs = [
    Events.On('copilot.status', (event) => handlers.status(event.data as CopilotStatus)),
    Events.On('copilot.install', (event) => handlers.install(event.data as CopilotInstallProgress)),
    Events.On('copilot.message', (event) => handlers.message(event.data as CopilotMessage)),
    Events.On('copilot.chat', (event) => handlers.chat(event.data as CopilotChatEvent)),
  ]
  return () => offs.forEach((off) => off())
}
