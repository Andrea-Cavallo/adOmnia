import type { GoStudioRunDraft } from './GoStudioDialogs'

export const DEFAULT_RUN_DRAFT: GoStudioRunDraft = {
  target: '.',
  workingDirectory: '',
  goArguments: '',
  programArguments: '',
  buildTags: '',
  environment: '',
}


/** Divide gli argomenti rispettando virgolette singole e doppie. */
export function splitArguments(value: string): string[] {
  const result: string[] = []
  let current = ''
  let quote = ''
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (quote) {
      if (character === quote) quote = ''
      else if (character === '\\' && value[index + 1] === quote) current += value[++index]
      else current += character
    } else if (character === '"' || character === "'") quote = character
    else if (/\s/.test(character)) { if (current) { result.push(current); current = '' } }
    else current += character
  }
  if (current) result.push(current)
  return result
}

/** Converte la bozza testuale della Run configuration in una richiesta strutturata, senza shell. */
export function runRequest(draft: GoStudioRunDraft) {
  const environment: Record<string, string> = {}
  for (const line of draft.environment.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) environment[line.slice(0, separator).trim()] = line.slice(separator + 1)
  }
  return {
    target: draft.target || '.',
    workingDirectory: draft.workingDirectory,
    goArguments: splitArguments(draft.goArguments),
    programArguments: splitArguments(draft.programArguments),
    buildTags: draft.buildTags.split(',').map((tag) => tag.trim()).filter(Boolean),
    environment,
  }
}
