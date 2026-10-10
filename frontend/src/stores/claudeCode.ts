import * as ClaudeCode from '../../bindings/adomnia/claudecode'
import type { Config } from '../../bindings/adomnia/internal/claudecode/models'
import { subscribeAgentEvents } from '@/lib/milk-api'
import { createAgentChatStore } from './agentChat'

/** Claude Code in gO Studio: same ACP client as milk, launched through its official adapter. */
export const useClaudeCodeStore = createAgentChatStore({
  status: () => ClaudeCode.Status(),
  settings: () => ClaudeCode.Settings(),
  saveSettings: (settings) => ClaudeCode.SaveSettings(settings),
  restart: () => ClaudeCode.Restart(),
  setWorkspace: (root) => ClaudeCode.SetActiveWorkspace(root),
  prompt: (request) => ClaudeCode.Prompt(request),
  cancelPrompt: (token) => ClaudeCode.CancelPrompt(token),
  resetSession: (root) => ClaudeCode.ResetSession(root),
  respondPermission: (requestId, allow) => ClaudeCode.RespondPermission(requestId, allow),
  subscribe: (handlers) => subscribeAgentEvents('claude', handlers),
})

export const getClaudeCodeLog = (): Promise<string[]> => ClaudeCode.Log()
export type ClaudeCodeConfig = Config
/** What Claude Code will use in a project (provider, model, settings files), never secret values. */
export const inspectClaudeCode = (root: string): Promise<ClaudeCodeConfig> => ClaudeCode.Inspect(root)
