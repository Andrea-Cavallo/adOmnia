import * as OpenCode from '../../bindings/adomnia/opencode'
import { subscribeAgentEvents } from '@/lib/milk-api'
import { createAgentChatStore } from './agentChat'

export const useOpenCodeStore = createAgentChatStore({
  localProvider: true,
  status: () => OpenCode.Status(), settings: () => OpenCode.Settings(),
  saveSettings: settings => OpenCode.SaveSettings(settings), restart: () => OpenCode.Restart(),
  setWorkspace: root => OpenCode.SetActiveWorkspace(root), prompt: request => OpenCode.Prompt(request),
  cancelPrompt: token => OpenCode.CancelPrompt(token), resetSession: root => OpenCode.ResetSession(root),
  respondPermission: (id, allow) => OpenCode.RespondPermission(id, allow),
  subscribe: handlers => subscribeAgentEvents('opencode', handlers),
})
export const listOllamaModels = (endpoint: string) => OpenCode.Models(endpoint)

export const checkOllamaModel = (endpoint: string, model: string) => OpenCode.CheckModel(endpoint, model)
