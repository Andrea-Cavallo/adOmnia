import { memo, type CSSProperties } from 'react'
import { Archive, BookOpen, File, FileCode2, FileImage, FileText, Key, Lock, Scale } from 'lucide-react'
import { BRAND_ICONS, type BrandIconSlug } from '@/lib/brandIcons.generated'
import { GoGopherIcon } from './GoGopherIcon'
import { brandColors, resolveGoStudioFileIcon } from './goStudioFileIcons'
import jenkinsEmblem from './assets/jenkins.png'

const GENERIC_ICONS = {
  text: FileText, pdf: FileText, image: FileImage, archive: Archive, lock: Lock,
  license: Scale, readme: BookOpen, code: FileCode2, key: Key, file: File,
} as const

/** Logo di un marchio (Simple Icons, 24×24) con il colore adatto al tema attivo. */
export const BrandIcon = memo(function BrandIcon({ slug, size = 14, dimmed = false }: { slug: BrandIconSlug; size?: number; dimmed?: boolean }) {
  const icon = BRAND_ICONS[slug]
  const colors = brandColors(icon.hex)
  const style = { '--brand-on-dark': colors.onDark, '--brand-on-light': colors.onLight } as CSSProperties
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={style} className={`go-studio-brand-icon shrink-0 text-text-2 ${dimmed ? 'opacity-55' : ''}`} role="img" aria-label={icon.title}>
      <path d={icon.path} />
    </svg>
  )
})

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
