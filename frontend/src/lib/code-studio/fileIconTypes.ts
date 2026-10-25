import type { BrandIconSlug } from '@/lib/brandIcons.generated'

export type IdeFileIcon =
  | { kind: 'gopher'; test: boolean }
  | { kind: 'goModule'; generated: boolean }
  | { kind: 'brand'; slug: BrandIconSlug }
  | { kind: 'jenkins' }
  | { kind: 'java' }
  | { kind: 'generic'; icon: 'text' | 'pdf' | 'image' | 'archive' | 'lock' | 'license' | 'readme' | 'code' | 'key' | 'sql' | 'terminal' | 'schema' | 'file' }
