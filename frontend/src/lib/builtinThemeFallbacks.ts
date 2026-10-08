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
    "description": "Shared cyan palette",
    "colors": {
      "on-accent": "#08202B",
      "surface-0": "#0B0F13",
      "surface-1": "#11171D",
      "surface-2": "#18212B",
      "surface-3": "#222D39",
      "surface-4": "#2D3B4A",
      "text-1": "#E8EDF5",
      "text-2": "#B5C0CF",
      "text-3": "#97A5B9",
      "text-4": "#78899F",
      "accent": "#7DD3FC",
      "accent-hover": "#A5E3FF",
      "accent-light": "#BAE6FD",
      "accent-dark": "#38BDF8",
      "accent-glow": "rgba(125, 211, 252, 0.14)",
      "border-1": "#28313C",
      "border-2": "#364352",
      "border-3": "#4A5A6C",
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
    "description": "Shared cyan palette",
    "colors": {
      "on-accent": "#FFFFFF",
      "accent-glow": "rgba(8, 125, 155, 0.12)",
      "accent-dark": "#06586C",
      "accent-light": "#096F89",
      "surface-0": "#FAFBFC",
      "surface-1": "#FFFFFF",
      "surface-2": "#F1F5F8",
      "surface-3": "#E5ECF2",
      "surface-4": "#D7E1EA",
      "text-1": "#172331",
      "text-2": "#405165",
      "text-3": "#5C6D82",
      "text-4": "#6D7F93",
      "accent": "#087D9B",
      "accent-hover": "#06677F",
      "border-1": "#DBE1E8",
      "border-2": "#C3CEDA",
      "border-3": "#A5B5C7",
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
