import { memo } from 'react'
import { Archive, BookOpen, Database, File, FileCode2, FileImage, FileText, Key, Lock, Scale, SquareTerminal, Workflow } from 'lucide-react'
import { BrandIcon } from '@/components/ui/BrandIcon'
import { GoGopherIcon } from './GoGopherIcon'
import { resolveGoStudioFileIcon } from './goStudioFileIcons'
import jenkinsEmblem from './assets/jenkins.png'

export { BrandIcon }

const GENERIC_ICONS = {
  text: FileText, pdf: FileText, image: FileImage, archive: Archive, lock: Lock,
  license: Scale, readme: BookOpen, code: FileCode2, key: Key, sql: Database, terminal: SquareTerminal, schema: Workflow, file: File,
} as const

/** Icona di un file in tutto Go Studio: gopher per i sorgenti Go, loghi reali, icone generiche. */
export const GoStudioFileIcon = memo(function GoStudioFileIcon({ name, relativePath, size = 14 }: { name: string; relativePath?: string; size?: number }) {
  const resolved = resolveGoStudioFileIcon(name, relativePath)
  switch (resolved.kind) {
    case 'gopher':
      if (!resolved.test) return <GoGopherIcon size={size + 1} />
      // I test hanno lo stesso gopher con un segno verde: si distinguono a colpo d'occhio.
      return (
        <span className="relative inline-flex shrink-0" title="Go test file">
          <GoGopherIcon size={size + 1} />
          <span className="absolute -bottom-px -right-px h-[5px] w-[5px] rounded-full bg-success ring-1 ring-surface-0" aria-hidden="true" />
        </span>
      )
    case 'goModule': return <BrandIcon slug="go" size={size} dimmed={resolved.generated} />
    case 'brand': return <BrandIcon slug={resolved.slug} size={size} />
    case 'jenkins': return <img src={jenkinsEmblem} width={size + 1} height={size + 1} alt="Jenkins" draggable={false} className="shrink-0 object-contain" />
    case 'generic': {
      const Icon = GENERIC_ICONS[resolved.icon]
      const tone = resolved.icon === 'pdf' ? 'text-danger' : resolved.icon === 'readme' ? 'text-accent' : resolved.icon === 'key' ? 'text-text-2' : 'text-text-4'
      return <Icon size={size} className={`shrink-0 ${tone}`} aria-hidden="true" />
    }
  }
})
