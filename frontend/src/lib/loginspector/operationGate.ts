export interface ImportOperation {
  id: number
  cancelled: boolean
  lastPreviewAt: number
}

/** Keeps async file reads, clipboard reads and parsers on one latest-operation contract. */
export class OperationGate {
  private sequence = 0
  private current: ImportOperation | null = null

  start(): ImportOperation {
    if (this.current) this.current.cancelled = true
    const operation = { id: ++this.sequence, cancelled: false, lastPreviewAt: 0 }
    this.current = operation
    return operation
  }

  isActive(operation: ImportOperation): boolean {
    return this.current === operation && !operation.cancelled
  }

  isCurrent(operation: ImportOperation): boolean {
    return this.current === operation
  }

  shouldAbort(operation: ImportOperation): boolean {
    return !this.isActive(operation)
  }

  cancel(operation = this.current): void {
    if (operation) operation.cancelled = true
    if (operation === this.current) this.current = null
  }

  requestAbort(operation = this.current): void {
    if (operation && operation === this.current) operation.cancelled = true
  }

  finish(operation: ImportOperation): void {
    if (operation === this.current) this.current = null
  }
}
