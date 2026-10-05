export interface TraceTreeSpan {
  spanId: string
  parentSpanId: string
}

export function traceTreeRows<T extends TraceTreeSpan>(spans: T[]): Array<{ span: T; depth: number }> {
  const firstById = new Map<string, number>()
  spans.forEach((span, index) => {
    if (!firstById.has(span.spanId)) firstById.set(span.spanId, index)
  })

  const children = spans.map(() => [] as number[])
  const roots: number[] = []
  spans.forEach((span, index) => {
    const parent = firstById.get(span.parentSpanId)
    if (parent === undefined || parent === index || !span.parentSpanId) {
      roots.push(index)
      return
    }
    const seen = new Set([index])
    let cursor: number | undefined = parent
    while (cursor !== undefined && !seen.has(cursor)) {
      seen.add(cursor)
      cursor = firstById.get(spans[cursor].parentSpanId)
    }
    if (cursor !== undefined) roots.push(index)
    else children[parent].push(index)
  })

  const result: Array<{ span: T; depth: number }> = []
  const visit = (index: number, depth: number) => {
    result.push({ span: spans[index], depth })
    for (const child of children[index]) visit(child, depth + 1)
  }
  for (const root of roots) visit(root, 0)
  return result
}
