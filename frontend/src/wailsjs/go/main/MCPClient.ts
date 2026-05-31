export function Connect(serverConfigJSON: string): Promise<string> {
  return window['go']['main']['MCPClient']['Connect'](serverConfigJSON)
}

export function Disconnect(): Promise<void> {
  return window['go']['main']['MCPClient']['Disconnect']()
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
