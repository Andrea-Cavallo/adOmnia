import { makeAutoObservable } from 'mobx'

export interface DesignNotice {
  id: number
  kind: 'error' | 'info'
  title: string
  description?: string
}

/** Messages of the editing engine, shown by the Design Mode panel. */
class Notices {
  items: DesignNotice[] = []
  private next = 1

  constructor() {
    makeAutoObservable(this)
  }

  error(title: string, description?: string) {
    this.push('error', title, description)
  }

  info(title: string, description?: string) {
    this.push('info', title, description)
  }

  dismiss(id: number) {
    this.items = this.items.filter((item) => item.id !== id)
  }

  clear() {
    this.items = []
  }

  private push(kind: DesignNotice['kind'], title: string, description?: string) {
    // The newest three are enough: a failing write repeats the same message.
    this.items = [...this.items.slice(-2), { id: this.next++, kind, title, description }]
  }
}

export const notices = new Notices()
