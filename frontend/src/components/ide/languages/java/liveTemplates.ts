import type { LiveTemplate } from '@/lib/code-studio/liveTemplates'

export const javaLiveTemplates: readonly LiveTemplate[] = [
  { id: 'java.sout', abbreviation: 'sout', description: 'Print to standard output', languages: ['java'], body: 'System.out.println($VALUE$);$END$' },
  { id: 'java.fori', abbreviation: 'fori', description: 'Indexed loop', languages: ['java'], body: 'for (int $INDEX$ = 0; $INDEX$ < $LIMIT$; $INDEX$++) {\n\t$END$\n}' },
  { id: 'java.if.surround', abbreviation: 'if', description: 'Surround with if', languages: ['java'], body: 'if ($CONDITION$) {\n\t$SELECTION$\n}\n$END$' },
  { id: 'java.try.surround', abbreviation: 'try', description: 'Surround with try/catch', languages: ['java'], body: 'try {\n\t$SELECTION$\n} catch ($TYPE$ $ERROR$) {\n\t$END$\n}' },
]
