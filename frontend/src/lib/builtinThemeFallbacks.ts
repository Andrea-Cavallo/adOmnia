import type { Theme } from '@/stores/themes'

// Local bootstrap when the desktop theme service is unavailable (browser preview).
// Keep default palettes aligned with internal/themes/themes.go and globals.css.
export const BUILTIN_THEME_FALLBACKS: Theme[] = [
  {
    "id": "builtin-dark",
    "name": "adOmnia Dark",
    "author": "adOmnia",
    "createdAt": "",
    "updatedAt": "",
    "version": "1.0.0",
    "description": "Monochrome palette",
    "colors": {
      "on-accent": "#000000",
      "surface-0": "#000000",
      "surface-1": "#080808",
      "surface-2": "#111111",
      "surface-3": "#191919",
      "surface-4": "#222222",
      "text-1": "#FFFFFF",
      "text-2": "#D4D4D4",
      "text-3": "#A8A8A8",
      "text-4": "#909090",
      "accent": "#FFFFFF",
      "accent-hover": "#E8E8E8",
      "accent-light": "#FFFFFF",
      "accent-dark": "#D4D4D4",
      "accent-glow": "rgba(255, 255, 255, 0.14)",
      "border-1": "#242424",
      "border-2": "#363636",
      "border-3": "#4A4A4A",
      "success": "oklch(72% 0.18 155)",
      "warning": "oklch(78% 0.16 80)",
      "error": "oklch(65% 0.2 25)",
      "info": "oklch(72% 0.14 230)"
    },
    "fonts": {
      "sans": "'Inter', 'Segoe UI', sans-serif",
      "mono": "'JetBrains Mono', monospace",
      "serif": "'Georgia', serif"
    },
    "spacing": {},
    "radii": {},
    "shadows": {},
    "meta": {
      "builtin": "true",
      "mode": "dark"
    }
  },
  {
    "id": "builtin-light",
    "name": "adOmnia White",
    "author": "adOmnia",
    "createdAt": "",
    "updatedAt": "",
    "version": "1.0.0",
    "description": "Monochrome palette",
    "colors": {
      "on-accent": "#FFFFFF",
      "accent-glow": "rgba(0, 0, 0, 0.12)",
      "accent-dark": "#000000",
      "accent-light": "#000000",
      "surface-0": "#FFFFFF",
      "surface-1": "#FAFAFA",
      "surface-2": "#F3F3F3",
      "surface-3": "#ECECEC",
      "surface-4": "#E4E4E4",
      "text-1": "#000000",
      "text-2": "#303030",
      "text-3": "#555555",
      "text-4": "#666666",
      "accent": "#000000",
      "accent-hover": "#222222",
      "border-1": "#D8D8D8",
      "border-2": "#BFBFBF",
      "border-3": "#999999",
      "success": "oklch(55% 0.18 155)",
      "warning": "oklch(65% 0.16 80)",
      "error": "oklch(55% 0.22 25)",
      "info": "oklch(55% 0.16 290)"
    },
    "fonts": {
      "sans": "'Inter', 'Segoe UI', sans-serif",
      "mono": "'JetBrains Mono', monospace",
      "serif": "'Georgia', serif"
    },
    "spacing": {},
    "radii": {},
    "shadows": {},
    "meta": {
      "builtin": "true",
      "mode": "light"
    }
  }
]
