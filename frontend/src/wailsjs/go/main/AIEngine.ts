export function Configure(configJSON: string): Promise<void> {
  return window['go']['main']['AIEngine']['Configure'](configJSON)
}

export function TestConnection(configJSON: string): Promise<string> {
  return window['go']['main']['AIEngine']['TestConnection'](configJSON)
}

export function Complete(provider: string, prompt: string, maxTokens: number): Promise<string> {
  return window['go']['main']['AIEngine']['Complete'](provider, prompt, maxTokens)
}

export function GenerateMockEndpoints(inputType: string, userInput: string): Promise<string> {
  return window['go']['main']['AIEngine']['GenerateMockEndpoints'](inputType, userInput)
}

export function ListModels(configJSON: string, query: string): Promise<string> {
  return window['go']['main']['AIEngine']['ListModels'](configJSON, query)
}
