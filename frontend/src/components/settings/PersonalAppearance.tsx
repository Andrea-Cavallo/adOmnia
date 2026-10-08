import { useEffect, useState, type CSSProperties } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useThemesStore } from '@/stores/themes'
import { useThemeContext } from '@/components/themes/ThemeProvider'
import { usePersonalAppearanceTranslation } from './personalAppearanceMessages'
import { personalColors, type PersonalColors } from '@/lib/personalAppearance'
import { validAccent, luminance } from '@/lib/accentPalette'
import { inferThemeMode } from '@/lib/themeCatalog'
import './PersonalAppearance.css'

export function PersonalAppearance() {
  const t = usePersonalAppearanceTranslation()
  const appearance = useSettingsStore((s) => s.settings.appearance)
  const update = useSettingsStore((s) => s.updateAppearance)
  const preview = useSettingsStore((s) => s.previewAppearance)
  const themes = useThemesStore((s) => s.themes)
  const { applyTheme } = useThemeContext()
  const snapshot = (): PersonalColors => ({
    themeId: appearance.themeId,
    accentColor: appearance.accentColor,
    baseColor: appearance.baseColor,
  })
  const [draft, setDraft] = useState<PersonalColors>(snapshot)
  const [live, setLive] = useState(false)
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const theme = themes.find((item) => item.id === draft.themeId)
  const mode = inferThemeMode(theme)
  const valid =
    (draft.accentColor === undefined || validAccent(draft.accentColor)) &&
    (draft.baseColor === undefined || validAccent(draft.baseColor))
  const tokens = personalColors(theme?.colors ?? {}, valid ? draft : {}, mode)
  const primary = validAccent(tokens.accent)
    ? tokens.accent
    : mode === 'dark'
      ? '#FFFFFF'
      : '#000000'
  const base = validAccent(tokens['surface-0'])
    ? tokens['surface-0']
    : mode === 'dark'
      ? '#000000'
      : '#FFFFFF'
  const previewStyle = Object.fromEntries(
    Object.entries(tokens).map(([key, value]) => [`--color-${key}`, value]),
  ) as CSSProperties

  useEffect(() => {
    setDraft(snapshot())
    setLive(false)
    preview(null)
  }, [
    appearance.themeId,
    appearance.accentColor,
    appearance.baseColor,
    preview,
  ])
  useEffect(() => {
    preview(live && valid ? draft : null)
  }, [draft, live, valid, preview])
  useEffect(() => () => preview(null), [preview])

  const reset = () => {
    setLive(false)
    preview(null)
    setDraft(snapshot())
    setNotice('')
    setSelectedId(null)
    setName('')
  }
  const apply = (profiles = appearance.profiles) => {
    if (!valid || !theme) return
    if (theme.id !== appearance.themeId) applyTheme(theme)
    update({
      ...draft,
      theme: validAccent(draft.baseColor)
        ? luminance(draft.baseColor) > 0.179
          ? 'light'
          : 'dark'
        : mode,
      profiles,
    })
    setLive(false)
    preview(null)
    setNotice(t('Style applied'))
  }
  const saveProfile = () => {
    if (!name.trim() || !valid || !theme) return
    const id = selectedId ?? crypto.randomUUID()
    const profile = { ...draft, id, name: name.trim().slice(0, 60) }
    const profiles = appearance.profiles ?? []
    if (!selectedId && profiles.length >= 50) {
      setNotice(t('Profile limit reached'))
      return
    }
    apply([...profiles.filter((p) => p.id !== id), profile])
    setSelectedId(id)
  }

  return (
    <section className="personal-appearance" aria-label={t('Your adOmnia')}>
      <header>
        <div>
          <h3>{t('Your adOmnia')}</h3>
          <p>
            {t(
              'Choose your colors. Preview first, then apply or save a profile.',
            )}
          </p>
        </div>
        <span aria-hidden="true">◌</span>
      </header>
      <div className="personal-modes">
        <button
          type="button"
          onClick={() =>
            setDraft({
              themeId: 'builtin-dark',
              accentColor: '#FFFFFF',
              baseColor: '#000000',
            })
          }
        >
          {t('Black / White')}
        </button>
        <button
          type="button"
          onClick={() =>
            setDraft({
              themeId: 'builtin-light',
              accentColor: '#000000',
              baseColor: '#FFFFFF',
            })
          }
        >
          {t('White / Black')}
        </button>
        <button
          type="button"
          onClick={() =>
            setDraft({
              themeId: draft.themeId,
              accentColor: undefined,
              baseColor: undefined,
            })
          }
        >
          {t('Use theme colors')}
        </button>
      </div>
      <div className="personal-color-grid">
        {(['accentColor', 'baseColor'] as const).map((key) => (
          <div key={key}>
            <label htmlFor={`personal-${key}`}>
              {t(key === 'accentColor' ? 'Primary color' : 'Base color')}
            </label>
            <div className="personal-color-input">
              <input
                id={`personal-${key}`}
                type="color"
                value={
                  validAccent(draft[key])
                    ? draft[key]
                    : key === 'accentColor'
                      ? primary
                      : base
                }
                onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              />
              <input
                aria-label={t(
                  key === 'accentColor'
                    ? 'Primary color HEX'
                    : 'Base color HEX',
                )}
                value={draft[key] ?? ''}
                placeholder={key === 'accentColor' ? primary : base}
                maxLength={7}
                spellCheck={false}
                aria-invalid={
                  draft[key] !== undefined && !validAccent(draft[key])
                }
                onChange={(e) =>
                  setDraft({ ...draft, [key]: e.target.value || undefined })
                }
              />
            </div>
          </div>
        ))}
      </div>
      <div
        className="personal-preview"
        style={previewStyle}
        aria-label={t('Style preview')}
      >
        <div className="personal-preview-rail">
          <i />
          <i />
          <i />
        </div>
        <div className="personal-preview-content">
          <small>adOmnia / API</small>
          <strong>{t('Your workspace, your style')}</strong>
          <div>
            <span>GET</span>
            <code>localhost:8080</code>
            <b>{t('Send')}</b>
          </div>
          <p>
            200 OK <span>12 ms</span>
          </p>
        </div>
      </div>
      <p className="personal-hint">
        {t(
          'Readable shades are derived automatically. Status colors keep their meaning.',
        )}
      </p>
      {!valid && (
        <p role="alert" className="personal-error">
          {t('Enter a six-digit HEX color, for example #FACC15.')}
        </p>
      )}
      <div className="personal-actions">
        <button
          type="button"
          aria-pressed={live}
          disabled={!valid}
          onClick={() => setLive(!live)}
        >
          {t(live ? 'Stop live preview' : 'Preview in app')}
        </button>
        <button type="button" onClick={reset}>
          {t('Cancel')}
        </button>
        <button
          type="button"
          className="personal-primary"
          disabled={!valid || !theme}
          onClick={() => apply()}
        >
          {t('Apply style')}
        </button>
      </div>
      <div className="personal-profiles">
        <h4>{t('Saved profiles')}</h4>
        {(appearance.profiles ?? []).length === 0 && (
          <p>
            {t(
              'Save a name for this look and switch back to it whenever you want.',
            )}
          </p>
        )}
        <div className="personal-profile-list">
          {(appearance.profiles ?? []).map((profile) => (
            <div key={profile.id}>
              <button
                type="button"
                aria-pressed={selectedId === profile.id}
                onClick={() => {
                  setDraft({
                    themeId: profile.themeId,
                    accentColor: profile.accentColor,
                    baseColor: profile.baseColor,
                  })
                  setSelectedId(profile.id)
                  setName(profile.name)
                  setNotice(
                    themes.some((item) => item.id === profile.themeId)
                      ? ''
                      : t('The theme for this profile is unavailable.'),
                  )
                }}
              >
                <i
                  style={{
                    background: profile.baseColor ?? 'var(--color-surface-0)',
                    borderColor: profile.accentColor ?? 'var(--color-accent)',
                  }}
                />
                {profile.name}
              </button>
              <button
                type="button"
                aria-label={`${t('Delete profile')}: ${profile.name}`}
                onClick={() => {
                  update({
                    profiles: (appearance.profiles ?? []).filter(
                      (p) => p.id !== profile.id,
                    ),
                  })
                  if (selectedId === profile.id) {
                    setSelectedId(null)
                    setName('')
                  }
                }}
              >
                {t('Delete')}
              </button>
            </div>
          ))}
        </div>
        <div className="personal-save">
          <input
            aria-label={t('Profile name')}
            value={name}
            maxLength={60}
            placeholder={t('Profile name')}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="button"
            disabled={!name.trim() || !valid || !theme}
            onClick={saveProfile}
          >
            {t(selectedId ? 'Update profile' : 'Save profile')}
          </button>
          {selectedId && (
            <button
              type="button"
              onClick={() => {
                setSelectedId(null)
                setName('')
              }}
            >
              {t('Save as new')}
            </button>
          )}
        </div>
      </div>
      {notice && (
        <p role="status" className="personal-hint">
          {notice}
        </p>
      )}
    </section>
  )
}
