import type { CodeStudioCommand } from '@/components/code-studio/codeStudioCommands'
import { WEB_HTML_ID } from '.'

export type WebLanguageCommandId =
  | 'preview.goLive' | 'preview.stop' | 'preview.restart' | 'preview.show' | 'preview.openFile'
  | 'preview.placeSplit' | 'preview.placeTab' | 'preview.placePanel' | 'preview.placeWindow'
  | 'preview.openWindow' | 'preview.openBrowser' | 'web.installTools'

const requires = { language: WEB_HTML_ID }

/** Comandi della Live Preview e degli strumenti web: nei menu Run, View e Tools. */
export const WEB_LANGUAGE_COMMANDS: ReadonlyArray<CodeStudioCommand> = ([
  { id: 'preview.goLive', menu: 'run', label: 'Go Live (Live Preview)', binding: { key: 'l', alt: true }, separatorBefore: true },
  { id: 'preview.stop', menu: 'run', label: 'Stop Live Preview' },
  { id: 'preview.restart', menu: 'run', label: 'Restart Live Preview' },
  { id: 'preview.show', menu: 'view', label: 'Live Preview', separatorBefore: true },
  { id: 'preview.placeSplit', menu: 'view', label: 'Live Preview: Split with Editor' },
  { id: 'preview.placeTab', menu: 'view', label: 'Live Preview: Tab next to Files' },
  { id: 'preview.placePanel', menu: 'view', label: 'Live Preview: Tool Window Panel' },
  { id: 'preview.placeWindow', menu: 'view', label: 'Live Preview: Separate Window' },
  { id: 'preview.openFile', menu: 'run', label: 'Open Current HTML File with Live Preview' },
  { id: 'preview.openWindow', menu: 'run', label: 'Open Live Preview in a Window' },
  { id: 'preview.openBrowser', menu: 'run', label: 'Open Live Preview in External Browser' },
  { id: 'web.installTools', menu: 'tools', label: 'Install Web Language Servers…' },
] satisfies ReadonlyArray<Omit<CodeStudioCommand, 'requires'>>).map((command) => ({ ...command, requires }))
