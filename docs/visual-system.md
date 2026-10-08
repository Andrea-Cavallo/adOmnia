# Default visual system

Dark and White share the same neutral surface hierarchy, cyan primary actions, text levels and border tokens. `internal/themes/themes.go` supplies the desktop palettes; `frontend/src/styles/globals.css` supplies startup defaults, and `frontend/src/lib/builtinThemeFallbacks.ts` supplies the same palettes when the desktop theme service is unavailable. Keep these three definitions aligned.

Panels, including the Hub, consume the shared CSS variables. Avoid independent panel background or accent palettes. Monaco and xterm keep matching default surface colours; syntax highlighting and ANSI colours retain their semantic meaning.

Primary actions use `--color-on-accent` for readable text. The default palette tests enforce AA contrast for primary text, secondary labels and filled actions. Theme changes clear properties owned by the previous theme before applying the next theme, so omitted properties use mode defaults.

Compatibility: existing `builtin-dark` and `builtin-light` IDs and saved preferences remain valid; no workspace or storage schema changes. Existing user themes keep their palettes. New installations use Inter for UI and JetBrains Mono for code; saved explicit font choices are preserved.

A user-selected HEX accent is stored as optional appearance.accentColor in existing local settings. Absence restores the theme palette; old settings need no migration. Derived accents meet text contrast for the active surface. Semantic status and syntax colours retain their meaning. The palette updates live, including Monaco selections and terminal cursors.
