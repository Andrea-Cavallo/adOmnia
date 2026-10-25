import { describe, expect, it } from 'vitest'
import type { ContextMenuItem } from '@/components/ui/ContextMenu'
import { compactFileMenu } from './CodeStudioMenuBar'

describe('compact File menu',()=>{
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
