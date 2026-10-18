import { analyzeJavaFile, localJavaCompletions } from './javaLocalAnalysis'
export interface JavaLocalSuggestion { label: string; detail: string; insertText: string; kind: 'Class' | 'Method' | 'Field' | 'Constant' | 'Variable' | 'Keyword' | 'Snippet'; snippet?: boolean }
const KEYWORDS = 'abstract assert boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long native new package private protected public record return sealed short static strictfp super switch synchronized this throw throws transient try var void volatile while yield true false null'.split(' ')
const SNIPPETS = [
  { label: 'sout', insertText: 'System.out.println(${1:value});', detail: 'Print to standard output' },
  { label: 'fori', insertText: 'for (int ${1:i} = 0; ${1:i} < ${2:limit}; ${1:i}++) {\n\t$0\n}', detail: 'Indexed for loop' },
  { label: 'main', insertText: 'public static void main(String[] args) {\n\t$0\n}', detail: 'Main method' },
]
export function completeLocalJava(source: string, offset: number): JavaLocalSuggestion[] {
  const analysis = analyzeJavaFile(source)
  if (analysis.limited || analysis.excluded.some(x => offset > x.start && (offset < x.end || (offset === x.end && x.endInclusive)))) return []
  const prefix = source.slice(Math.max(0, offset - 256), offset).replace(/[\p{L}\p{N}_$]*$/u, '')
  const member = prefix.endsWith('.')
  // No guessed members of unresolved expressions or library types.
  if (member && !/\bthis\.$/.test(prefix)) return []
  const declarations = localJavaCompletions(analysis, offset).filter(x => !member || [6,8,14].includes(x.kind))
  const names = new Set(declarations.map(x => x.name))
  const suggestions: JavaLocalSuggestion[] = declarations.map(x => ({ label: x.name, insertText: x.name, detail: `Local Java · ${x.detail}`, kind: x.kind === 5 || x.kind === 10 || x.kind === 11 ? 'Class' : x.kind === 6 || x.kind === 9 ? 'Method' : x.kind === 8 ? 'Field' : [14,22].includes(x.kind) ? 'Constant' : 'Variable' }))
  if (!member) {
    for (const label of KEYWORDS) if (!names.has(label)) suggestions.push({ label, insertText: label, detail: 'Java keyword', kind: 'Keyword' })
    for (const snippet of SNIPPETS) if (!names.has(snippet.label)) suggestions.push({ ...snippet, detail: `Local Java · ${snippet.detail}`, kind: 'Snippet', snippet: true })
  }
  return suggestions
}
