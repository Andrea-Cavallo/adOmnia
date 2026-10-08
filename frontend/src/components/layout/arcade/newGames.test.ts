import { describe, expect, it, vi } from 'vitest'
import { bubbleGame, settleBubble } from './bubble'
import { racerGame } from './racer'

describe('Dot Bubble', () => {
  it('removes three matching bubbles and drops disconnected ones', () => {
    const s = { ...bubbleGame.init(30, 21), bubbles: [{ col:0,row:0,kind:0 },{ col:1,row:0,kind:0 },{ col:0,row:1,kind:2 }] }
    const next = settleBubble(s,{ col:2,row:0,kind:0 })
    expect(next.bubbles).toHaveLength(0)
    expect(next.score).toBe(50)
    expect(next.won).toBe(true)
  })
  it('keeps unmatched groups and raises pressure every six shots', () => {
    const s = { ...bubbleGame.init(30,21), shots:5 }
    const next = settleBubble(s,{ col:0,row:2,kind:1 })
    expect(next.shots).toBe(6)
    expect(next.bubbles.filter(b=>b.row===0)).toHaveLength(s.width)
    expect(next.score).toBe(0)
  })
  it('fires only one bubble, bounces off walls and attaches at the ceiling', () => {
    const s=bubbleGame.init(30,21)
    const fired=bubbleGame.press(s,'action')
    expect(fired.shot).not.toBeNull()
    expect(bubbleGame.press(fired,'action')).toBe(fired)
    const wall=bubbleGame.update({...fired,shot:{x:1.1,y:12,vx:-25,vy:-3,kind:0}},0.02,new Set())
    expect(wall.shot!.vx).toBeGreaterThan(0)
    const top=bubbleGame.update({...fired,bubbles:[],shot:{x:15,y:1.6,vx:0,vy:-25,kind:0}},0.02,new Set())
    expect(top.shot).toBeNull()
    expect(top.bubbles).toHaveLength(1)
  })
  it('ends when bubbles cross the danger line and resets cleanly', () => {
    const s=bubbleGame.init(30,21)
    expect(settleBubble(s,{col:0,row:6,kind:2}).over).toBe(true)
    expect(bubbleGame.init(30,21).score).toBe(0)
  })
})

describe('Glyph Racer', () => {
  it('limits lane changes and moves smoothly toward the selected lane', () => {
    const s=racerGame.init(30,21)
    const left=racerGame.press(racerGame.press(s,'left'),'left')
    expect(left.lane).toBe(0)
    expect(racerGame.update(left,0.02,new Set()).position).toBeLessThan(1)
  })
  it('collects energy once and ends on an obstacle crossing the car', () => {
    const s=racerGame.init(30,21)
    const pickup=racerGame.update({...s,objects:[{lane:1,y:17,energy:true}]},0.02,new Set())
    expect(pickup.score).toBe(10)
    expect(pickup.objects).toHaveLength(0)
    expect(racerGame.update({...s,objects:[{lane:1,y:17,energy:false}]},0.02,new Set()).over).toBe(true)
    expect(racerGame.update({...s,objects:[{lane:0,y:17,energy:false}]},0.02,new Set()).over).toBe(false)
  })
  it('leaves escape lanes open, caps difficulty and clears the run on restart', () => {
    const random=vi.spyOn(Math,'random').mockReturnValue(0.2)
    try {
      const s=racerGame.update({...racerGame.init(30,21),elapsed:500,spawn:0},0.02,new Set())
      expect(s.objects.filter(o=>!o.energy)).toHaveLength(1)
      expect(s.objects.filter(o=>o.energy)[0].lane).not.toBe(s.objects[0].lane)
      expect(s.spawn).toBe(0.8)
      expect(racerGame.init(30,21).objects).toHaveLength(0)
    } finally {random.mockRestore()}
  })
})
