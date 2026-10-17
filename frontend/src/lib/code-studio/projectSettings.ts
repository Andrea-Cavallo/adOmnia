import type { EditorConfigProperties } from '@/components/code-studio/codeStudioEditorConfig'

/**
 * `.adomnia/settings.json`: impostazioni di progetto in JSON con schema, da committare.
 * Livelli: utente (le impostazioni dell'app, salvate come oggi) poi questo file, che vince.
 * Solo chiavi con effetto reale: ogni sezione qui sotto è agganciata a un consumer vero
 * (editor di Code Studio, indentazione, scorciatoie).
 */

export const PROJECT_SETTINGS_PATH = '.adomnia/settings.json'
export const PROJECT_SETTINGS_FORMAT = 'adomnia-settings'
export const PROJECT_SETTINGS_VERSION = 1

export type CodeStudioKeymapPreset = 'goland' | 'vscode'

/** Scorciatoia in JSON: gli stessi campi del registro comandi più la condizione `when`. */
export interface ProjectKeyBinding {
  key: string
  mod?: boolean
  shift?: boolean
  alt?: boolean
  /** Condizione sul contesto (es. `editor && vim.normal`, `!input`); senza `when` vale sempre. */
  when?: string
}

export interface ProjectKeymapOverride {
  preset?: CodeStudioKeymapPreset
  /** Comando → scorciatoia, oppure null per togliere il tasto al comando. */
  bindings?: Record<string, ProjectKeyBinding | null>
}

export interface ProjectEditorSettings {
  tabSize?: number
  softTabs?: boolean
  wordWrap?: 'off' | 'on'
  lineNumbers?: 'on' | 'off'
  fontSize?: number
  fontLigatures?: boolean
  editorMode?: 'default' | 'vim' | 'emacs'
  stickyScroll?: boolean
}

export interface ProjectSettings {
  editor: ProjectEditorSettings
  keymap: ProjectKeymapOverride
}

export interface ProjectSettingsResult {
  settings: ProjectSettings
  /** Chiavi sconosciute o valori non validi: segnalate e ignorate, il resto si applica. */
  errors: string[]
  /** File assente o vuoto: nessuna impostazione di progetto. */
  empty: boolean
}

export const EMPTY_PROJECT_SETTINGS: ProjectSettings = { editor: {}, keymap: {} }

const EDITOR_KEYS: Readonly<Record<string, 'number' | 'boolean' | 'wrap' | 'lineNumbers' | 'mode'>> = {
  tabSize: 'number',
  softTabs: 'boolean',
  wordWrap: 'wrap',
  lineNumbers: 'lineNumbers',
  fontSize: 'number',
  fontLigatures: 'boolean',
  editorMode: 'mode',
  stickyScroll: 'boolean',
}

const BINDING_KEYS = new Set(['key', 'mod', 'shift', 'alt', 'when'])

/**
 * Schema JSON del file (documentazione e autocompletamento nell'editor). Il parsing qui sopra
 * accetta esattamente queste chiavi: `projectSettings.test.ts` tiene allineati i due elenchi.
 */
export const PROJECT_SETTINGS_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'adOmnia project settings',
  description: 'Project settings for adOmnia Code Studio, layered over the user settings. Commit this file to share the setup with the team.',
  type: 'object',
  additionalProperties: false,
  required: ['format', 'version'],
  properties: {
    format: { const: PROJECT_SETTINGS_FORMAT, description: 'File format marker.' },
    version: { const: PROJECT_SETTINGS_VERSION, description: 'Settings file version.' },
    editor: {
      type: 'object',
      additionalProperties: false,
      description: 'Editor settings for this project. They win over .editorconfig and over the user settings.',
      properties: {
        tabSize: { type: 'integer', minimum: 1, maximum: 16, description: 'Tab width in spaces.' },
        softTabs: { type: 'boolean', description: 'Insert spaces instead of tab characters.' },
        wordWrap: { enum: ['off', 'on'], description: 'Wrap long lines.' },
        lineNumbers: { enum: ['on', 'off'], description: 'Show line numbers.' },
        fontSize: { type: 'integer', minimum: 8, maximum: 32, description: 'Editor font size.' },
        fontLigatures: { type: 'boolean', description: 'Enable font ligatures.' },
        editorMode: { enum: ['default', 'vim', 'emacs'], description: 'Keyboard emulation for the editor.' },
        stickyScroll: { type: 'boolean', description: 'Pin the enclosing scopes at the top of the editor.' },
      },
    },
    keymap: {
      type: 'object',
      additionalProperties: false,
      description: 'Keyboard shortcuts for this project, layered over the user keymap.',
      properties: {
        preset: { enum: ['goland', 'vscode'], description: 'Base keymap for commands the project does not rebind.' },
        bindings: {
          type: 'object',
          description: 'Command id → shortcut object, or null to unbind the command.',
          additionalProperties: {
            oneOf: [
              { type: 'null' },
              {
                type: 'object',
                additionalProperties: false,
                required: ['key'],
                properties: {
                  key: { type: 'string', minLength: 1, description: 'Key name: a letter, a digit, F1…F12, Enter, Escape, ArrowUp…' },
                  mod: { type: 'boolean', description: 'Ctrl on Windows/Linux, Cmd on macOS.' },
                  shift: { type: 'boolean', description: 'Shift modifier.' },
                  alt: { type: 'boolean', description: 'Alt modifier.' },
                  when: { type: 'string', minLength: 1, description: 'Context condition, e.g. "editor && vim.normal", "!input", "editor || terminal".' },
                },
              },
            ],
          },
        },
      },
    },
  },
} as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseEditor(value: unknown, errors: string[]): ProjectEditorSettings {
  const editor: ProjectEditorSettings = {}
  if (!isPlainObject(value)) {
    if (value !== undefined) errors.push('editor: expected an object.')
    return editor
  }
  for (const [key, raw] of Object.entries(value)) {
    const kind = EDITOR_KEYS[key]
    if (!kind) {
      errors.push(`editor.${key}: unknown key.`)
      continue
    }
    if (kind === 'boolean' && typeof raw === 'boolean') (editor as Record<string, unknown>)[key] = raw
    else if (kind === 'number' && typeof raw === 'number' && Number.isFinite(raw) && (key !== 'tabSize' || (raw >= 1 && raw <= 16)) && (key !== 'fontSize' || (raw >= 8 && raw <= 32))) (editor as Record<string, unknown>)[key] = raw
    else if (kind === 'wrap' && (raw === 'off' || raw === 'on')) editor.wordWrap = raw
    else if (kind === 'lineNumbers' && (raw === 'on' || raw === 'off')) editor.lineNumbers = raw
    else if (kind === 'mode' && (raw === 'default' || raw === 'vim' || raw === 'emacs')) editor.editorMode = raw
    else errors.push(`editor.${key}: invalid value ${JSON.stringify(raw)}.`)
  }
  return editor
}

function parseBinding(id: string, value: unknown, errors: string[]): ProjectKeyBinding | null | undefined {
  if (value === null) return null
  if (!isPlainObject(value)) {
    errors.push(`keymap.bindings.${id}: expected an object with "key" or null.`)
    return undefined
  }
  for (const key of Object.keys(value)) {
    if (!BINDING_KEYS.has(key)) errors.push(`keymap.bindings.${id}.${key}: unknown key.`)
  }
  const key = value.key
  if (typeof key !== 'string' || !key) {
    errors.push(`keymap.bindings.${id}: "key" must be a non-empty string.`)
    return undefined
  }
  const binding: ProjectKeyBinding = { key }
  for (const flag of ['mod', 'shift', 'alt'] as const) {
    if (value[flag] === undefined) continue
    if (typeof value[flag] !== 'boolean') {
      errors.push(`keymap.bindings.${id}.${flag}: expected true or false.`)
      continue
    }
    binding[flag] = value[flag] as boolean
  }
  if (value.when !== undefined) {
    if (typeof value.when !== 'string' || !value.when.trim()) {
      errors.push(`keymap.bindings.${id}.when: expected a non-empty string.`)
    } else binding.when = value.when
  }
  return binding
}

function parseKeymap(value: unknown, errors: string[]): ProjectKeymapOverride {
  const keymap: ProjectKeymapOverride = {}
  if (!isPlainObject(value)) {
    if (value !== undefined) errors.push('keymap: expected an object.')
    return keymap
  }
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'preset') {
      if (raw === 'goland' || raw === 'vscode') keymap.preset = raw
      else errors.push(`keymap.preset: invalid value ${JSON.stringify(raw)}.`)
      continue
    }
    if (key !== 'bindings') {
      errors.push(`keymap.${key}: unknown key.`)
      continue
    }
    if (!isPlainObject(raw)) {
      errors.push('keymap.bindings: expected an object of command ids.')
      continue
    }
    const bindings: Record<string, ProjectKeyBinding | null> = {}
    for (const [id, entry] of Object.entries(raw)) {
      const binding = parseBinding(id, entry, errors)
      if (binding !== undefined) bindings[id] = binding
    }
    keymap.bindings = bindings
  }
  return keymap
}

/**
 * Legge `.adomnia/settings.json`. Le chiavi sbagliate finiscono in `errors` e non si applicano;
 * il resto del file funziona. File assente o vuoto → `empty`, senza errori.
 */
export function parseProjectSettings(raw: string): ProjectSettingsResult {
  if (!raw.trim()) return { settings: EMPTY_PROJECT_SETTINGS, errors: [], empty: true }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { settings: EMPTY_PROJECT_SETTINGS, errors: [`${PROJECT_SETTINGS_PATH} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`], empty: true }
  }
  const errors: string[] = []
  if (!isPlainObject(parsed)) return { settings: EMPTY_PROJECT_SETTINGS, errors: [`${PROJECT_SETTINGS_PATH} must contain a JSON object.`], empty: true }
  if (parsed.format !== PROJECT_SETTINGS_FORMAT) errors.push(`format: expected "${PROJECT_SETTINGS_FORMAT}".`)
  if (parsed.version !== PROJECT_SETTINGS_VERSION) errors.push(`version: expected ${PROJECT_SETTINGS_VERSION}.`)
  for (const key of Object.keys(parsed)) {
    if (key !== 'format' && key !== 'version' && key !== 'editor' && key !== 'keymap') errors.push(`${key}: unknown key.`)
  }
  return {
    settings: { editor: parseEditor(parsed.editor, errors), keymap: parseKeymap(parsed.keymap, errors) },
    errors,
    empty: false,
  }
}

/** Le impostazioni di progetto vincono su quelle utente, chiave per chiave. */
export function mergeEditorSettings(base: ProjectEditorSettings, override: ProjectEditorSettings): ProjectEditorSettings {
  return { ...base, ...Object.fromEntries(Object.entries(override).filter(([, value]) => value !== undefined)) }
}

/**
 * Indentazione effettiva: `.adomnia/settings.json` è il livello più esplicito e vince su
 * `.editorconfig`, che a sua volta vince sui default.
 */
export function editorConfigWithProject(config: EditorConfigProperties, project: ProjectEditorSettings): EditorConfigProperties {
  const next: EditorConfigProperties = { ...config }
  if (project.softTabs !== undefined) next.indent_style = project.softTabs ? 'space' : 'tab'
  if (project.tabSize !== undefined) {
    next.tab_width = project.tabSize
    next.indent_size = project.tabSize
  }
  return next
}
