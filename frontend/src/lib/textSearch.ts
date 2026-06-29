export interface TextSearchOptions {
  matchCase?: boolean
  wholeWord?: boolean
}

function isWordCharacter(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}_]/u.test(char)
}

export function findTextMatches(text: string, query: string, options: TextSearchOptions = {}): number[] {
  if (!query) return []

  const haystack = options.matchCase ? text : text.toLocaleLowerCase()
  const needle = options.matchCase ? query : query.toLocaleLowerCase()
  const matches: number[] = []
  let index = haystack.indexOf(needle)

  while (index !== -1) {
    const end = index + needle.length
    const isWholeWord = !options.wholeWord
      || (!isWordCharacter(text[index - 1]) && !isWordCharacter(text[end]))
    if (isWholeWord) matches.push(index)
    index = haystack.indexOf(needle, index + Math.max(needle.length, 1))
  }

  return matches
}
