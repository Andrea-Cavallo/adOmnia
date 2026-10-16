/** Mirrors `git check-ref-format --branch` closely enough to reject bad input before spawning git. */
export function branchNameError(raw: string): string | null {
  const name = raw.trim()
  if (!name) return 'Enter a branch name.'
  if (name.length > 200) return 'Branch name is too long.'
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name)) return 'Branch names cannot contain spaces or any of ~ ^ : ? * [ \\.'
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return 'Branch name is not valid.'
  if (name.includes('..') || name.includes('//') || name.includes('@{') || name === '@') return 'Branch name is not valid.'
  if (name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) return 'Branch name is not valid.'
  return null
}
