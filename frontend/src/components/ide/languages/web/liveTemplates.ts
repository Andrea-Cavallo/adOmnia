import type { LiveTemplate } from '@/lib/code-studio/liveTemplates'

const languages = ['typescript', 'javascript']
export const webLiveTemplates: readonly LiveTemplate[] = [
  { id: 'web.log', abbreviation: 'log', description: 'Log a value', languages, body: 'console.log($VALUE$);$END$' },
  { id: 'web.function', abbreviation: 'function', description: 'Function declaration', languages, body: 'function $NAME$($PARAMETERS$) {\n\t$END$\n}' },
  { id: 'web.if.surround', abbreviation: 'if', description: 'Surround with if', languages, body: 'if ($CONDITION$) {\n\t$SELECTION$\n}\n$END$' },
  { id: 'web.try.surround', abbreviation: 'try', description: 'Surround with try/catch', languages, body: 'try {\n\t$SELECTION$\n} catch ($ERROR$) {\n\t$END$\n}' },
]
