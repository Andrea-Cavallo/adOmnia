import type { LiveTemplate } from '@/lib/code-studio/liveTemplates'

export const rustLiveTemplates: readonly LiveTemplate[] = [
  { id: 'rust.fn', abbreviation: 'fn', description: 'Function definition', languages: ['rust'], body: 'fn $NAME$($PARAMETERS$) {\n\t$END$\n}' },
  { id: 'rust.println', abbreviation: 'println', description: 'Print with debug formatting', languages: ['rust'], body: 'println!("{:?}", $VALUE$);$END$' },
  { id: 'rust.if.surround', abbreviation: 'if', description: 'Surround with if', languages: ['rust'], body: 'if $CONDITION$ {\n\t$SELECTION$\n}\n$END$' },
  { id: 'rust.loop.surround', abbreviation: 'loop', description: 'Surround with loop', languages: ['rust'], body: 'loop {\n\t$SELECTION$\n}\n$END$' },
]
