import * as Pi from '../../bindings/github.com/Andrea-Cavallo/adOmnia/piagent'
import { subscribeAgentEvents } from '@/lib/milk-api'
import { createAgentChatStore } from './agentChat'

export const usePiAgentStore = createAgentChatStore({
  status: () => Pi.Status(), settings: () => Pi.Settings(),
  saveSettings: settings => Pi.SaveSettings(settings), restart: () => Pi.Restart(),
  setWorkspace: root => Pi.SetActiveWorkspace(root), prompt: request => Pi.Prompt(request),
  cancelPrompt: token => Pi.CancelPrompt(token), resetSession: root => Pi.ResetSession(root),
  respondPermission: (id, allow) => Pi.RespondPermission(id, allow),
  subscribe: handlers => subscribeAgentEvents('pi', handlers), install: () => Pi.Install(),
})
