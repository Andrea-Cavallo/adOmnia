export function goStudioUnwrapExpression(expression: string): string {
  return `(${expression}).(interface{ Unwrap() error }).Unwrap()`
}

/** Delve rende i nil in modi leggermente diversi a seconda del tipo dinamico. */
export function isNilGoStudioDebugValue(value: string): boolean {
  return /^<nil>$|^nil$/i.test(value.trim())
}
