import { describe, expect, it } from 'vitest'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import { compactFileMenu, mainMenuItems } from './CodeStudioMenuBar'
import { CODE_STUDIO_COMMANDS, CODE_STUDIO_MENUS } from './codeStudioCommands'

describe('compact File menu',()=>{
  it('keeps the command registry and availability intact in the branched tree', () => {
    const menus = mainMenuItems({ availability: id => id === 'file.save' ? 'No active document' : true, checked: id => id === 'file.autoSave' }, [], [])
    const flatten = (items: ContextMenuItem[]): ContextMenuItem[] => items.flatMap(item => [item, ...flatten(item.submenu ?? [])])
    const all = flatten(menus)
    const expected = CODE_STUDIO_COMMANDS.filter(command => CODE_STUDIO_MENUS.some(menu => menu.id === command.menu))
    for (const command of expected) expect(all.filter(item => item.id === command.id)).toHaveLength(1)
    expect(all.find(item => item.id === 'file.save')).toMatchObject({ disabled: true, disabledReason: 'No active document' })
    expect(all.find(item => item.id === 'file.autoSave')?.checked).toBe(true)
  })
  it('keeps every original command, shortcut and disabled reason in its submenu',()=>{
    const items: ContextMenuItem[] = [
      {id:'file.save',label:'Save',shortcut:'Ctrl+S'},
      {id:'file.autoSave',label:'Auto save',checked:true},
      {id:'file.trimWhitespace',label:'Trim'},
      {id:'file.closeEditor',label:'Close',shortcut:'Ctrl+W'},
      {id:'file.closeOthers',label:'Close others',disabled:true,disabledReason:'No other tabs'},
      {id:'file.pinTab',label:'Pin'},
      {id:'window.openInNewWindow',label:'New window'},
    ]
    const compact = compactFileMenu(items)
    const leaves = compact.flatMap(item=>item.submenu ?? [item])
    expect(leaves.map(item=>item.id).sort()).toEqual(items.map(item=>item.id).sort())
    expect(compact.find(item=>item.id==='file.save')?.shortcut).toBe('Ctrl+S')
    expect(compact.find(item=>item.id==='file.editorTabs')?.submenu?.[0]).toMatchObject({id:'file.closeOthers',disabled:true,disabledReason:'No other tabs'})
    expect(compact.filter(item=>item.id==='file.saveOptions')).toHaveLength(1)
    expect(compact).toHaveLength(5)
  })
})
