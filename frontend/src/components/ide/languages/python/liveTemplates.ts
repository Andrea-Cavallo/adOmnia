import type { LiveTemplate } from '@/lib/code-studio/liveTemplates'

export const pythonLiveTemplates: readonly LiveTemplate[] = [
  { id: 'python.main', abbreviation: 'main', description: 'Main entry guard', languages: ['python'], body: 'if __name__ == "__main__":\n\t$END$' },
  { id: 'python.def', abbreviation: 'def', description: 'Function definition', languages: ['python'], body: 'def $NAME$($PARAMETERS$):\n\t$END$' },
  { id: 'python.if.surround', abbreviation: 'if', description: 'Surround with if', languages: ['python'], body: 'if $CONDITION$:\n\t$SELECTION$\n$END$' },
  { id: 'python.try.surround', abbreviation: 'try', description: 'Surround with try/except', languages: ['python'], body: 'try:\n\t$SELECTION$\nexcept $TYPE$ as $ERROR$:\n\t$END$' },
]
