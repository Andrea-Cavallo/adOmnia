declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string
  export interface Dirent {
    name: string
    isDirectory(): boolean
    isFile(): boolean
  }
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[]
}

declare module 'node:path' {
  export function join(...paths: string[]): string
  export function relative(from: string, to: string): string
  export function resolve(...paths: string[]): string
}

declare const process: {
  cwd(): string
}
