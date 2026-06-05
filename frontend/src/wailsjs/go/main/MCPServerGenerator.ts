export function Generate(inputJSON: string, outputDir: string): Promise<string> {
  return window['go']['main']['MCPServerGenerator']['Generate'](inputJSON, outputDir)
}
