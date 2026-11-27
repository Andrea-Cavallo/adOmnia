import type { LiveTemplate } from '@/lib/code-studio/liveTemplates'

export const goLiveTemplates: readonly LiveTemplate[] = [
  { id: 'go.iferr', abbreviation: 'iferr', description: 'Return an error', languages: ['go'], body: 'if err != nil {\n\treturn $RESULT$\n}\n$END$' },
  { id: 'go.range', abbreviation: 'forrange', description: 'Range over a collection', languages: ['go'], body: 'for $INDEX$, $VALUE$ := range $COLLECTION$ {\n\t$END$\n}' },
  { id: 'go.if.surround', abbreviation: 'if', description: 'Surround with if', languages: ['go'], body: 'if $CONDITION$ {\n\t$SELECTION$\n}\n$END$' },
  { id: 'go.for.surround', abbreviation: 'for', description: 'Surround with for', languages: ['go'], body: 'for $CONDITION$ {\n\t$SELECTION$\n}\n$END$' },
]
