export function Connect(serverConfigJSON: string): Promise<string> {
  return window['go']['main']['MCPClient']['Connect'](serverConfigJSON)
}

export function ConnectSession(sessionID: string, serverConfigJSON: string): Promise<string> {
  return window['go']['main']['MCPClient']['ConnectSession'](sessionID, serverConfigJSON)
}

export function Disconnect(): Promise<void> {
  return window['go']['main']['MCPClient']['Disconnect']()
}

export function DisconnectSession(sessionID: string): Promise<void> {
  return window['go']['main']['MCPClient']['DisconnectSession'](sessionID)
}

export function GetSessionStatus(sessionID: string): Promise<string> {
  return window['go']['main']['MCPClient']['GetSessionStatus'](sessionID)
}

export function ListTools(): Promise<string> {
  return window['go']['main']['MCPClient']['ListTools']()
}

export function CallTool(toolName: string, argsJSON: string): Promise<string> {
  return window['go']['main']['MCPClient']['CallTool'](toolName, argsJSON)
}

export function ListResources(): Promise<string> {
  return window['go']['main']['MCPClient']['ListResources']()
}

export function ListPrompts(): Promise<string> {
  return window['go']['main']['MCPClient']['ListPrompts']()
}

export function ListSessions(): Promise<string> {
  return window['go']['main']['MCPClient']['ListSessions']()
}

export function RestartSession(sessionID: string): Promise<string> {
  return window['go']['main']['MCPClient']['RestartSession'](sessionID)
}
