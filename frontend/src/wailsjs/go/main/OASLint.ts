export function Lint(specText: string, rulesetJSON: string): Promise<string> {
  return window['go']['main']['OASLint']['Lint'](specText, rulesetJSON)
}
