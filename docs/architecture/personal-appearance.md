# Personal appearance

Settings > Appearance provides a primary color, base color, an isolated preview card, a temporary whole-app preview and up to 50 named local profiles. New installations use black surfaces with a white primary color; the light default reverses these colors. Existing explicit accent colors and custom themes remain selected.

The theme remains the source of fonts, spacing, radii and semantic status colors. Primary/base overrides derive the surface hierarchy, readable text, syntax tokens and action foreground through `personalColors`. Requested colors remain in settings; displayed primary shades may be adjusted to reach a contrast ratio of at least 4.5 against the derived surfaces. Shared CSS tokens propagate these choices to panels and the arcade. Colors do not require an animation loop or per-frame React updates.

## Storage and compatibility

Settings schema 14 adds optional `appearance.baseColor` and `appearance.profiles`. Each profile contains `id`, `name`, `themeId` and optional `accentColor`/`baseColor` in six-digit HEX format. Profile names are limited to 60 characters. Missing values inherit the selected theme. Invalid bases/profiles and duplicate profile IDs are discarded on load. Older settings merge with defaults and retain explicit accents; migration saves the updated schema using the existing ordered settings write path.

The backend continues storing the settings JSON locally through `SaveSettings`; no backend schema or `.adomnia` workspace format changes are needed. Profiles travel with the existing settings export/import. No cloud service or telemetry is involved.

`appearancePreview` belongs to the transient Zustand state, outside `settings`, and is never serialized. Cancel, stopping preview or leaving the Appearance section restores saved tokens. Apply commits the draft; saving a named profile also applies it. Selecting a profile loads its draft for preview or Apply. Profiles referencing a missing theme remain listed but cannot be applied until that theme is available.

This supports the local-first and user-extensibility pillars through local persistence and user-controlled reusable appearance profiles.
