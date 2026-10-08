import type { DotGame, Painter } from './types'

export interface Bubble { col: number; row: number; kind: number }
export interface BubbleState {
  cols: number; rows: number; width: number; bubbles: Bubble[]
  angle: number; loaded: number; next: number
  shot: { x: number; y: number; vx: number; vy: number; kind: number } | null
  shots: number; score: number; over: boolean; won: boolean
}
const neighbors = (a: Bubble, b: Bubble) => Math.abs(a.col-b.col) + Math.abs(a.row-b.row) === 1
const center = (s: BubbleState, b: Bubble) => ({ x: (s.cols - (s.width-1)*3) / 2 + b.col*3, y: 1.5 + b.row*3 })
const kind = (bubbles: Bubble[]) => {
  const kinds = [...new Set(bubbles.map(b => b.kind))]
  return kinds[Math.floor(Math.random()*kinds.length)] ?? 0
}

/** Removes matching groups and every bubble disconnected from the ceiling. */
export function settleBubble(s: BubbleState, placed: Bubble): BubbleState {
  let bubbles = [...s.bubbles, placed]
  const group = new Set<Bubble>([placed]), queue = [placed]
  while (queue.length) {
    const current = queue.pop()!
    for (const b of bubbles) if (!group.has(b) && b.kind === placed.kind && neighbors(current,b)) { group.add(b); queue.push(b) }
  }
  let score = s.score
  if (group.size >= 3) {
    bubbles = bubbles.filter(b => !group.has(b)); score += group.size*10
    const attached = new Set(bubbles.filter(b => b.row === 0)), pending = [...attached]
    while (pending.length) {
      const current = pending.pop()!
      for (const b of bubbles) if (!attached.has(b) && neighbors(current,b)) { attached.add(b); pending.push(b) }
    }
    score += (bubbles.length-attached.size)*20
    bubbles = bubbles.filter(b => attached.has(b))
  }
  const shots = s.shots + 1
  if (shots % 6 === 0 && bubbles.length) {
    bubbles = bubbles.map(b => ({ ...b, row: b.row+1 }))
    for (let col=0;col<s.width;col++) bubbles.push({col,row:0,kind:Math.floor(Math.random()*3)})
  }
  const won = !bubbles.length
  const over = won || bubbles.some(b => center(s,b).y >= s.rows-4)
  return { ...s, bubbles, shots, score, shot: null, loaded: bubbles.some(b => b.kind === s.next) ? s.next : kind(bubbles), next: kind(bubbles), won, over }
}

function attach(s: BubbleState): BubbleState {
  const shot = s.shot!
  let target: Bubble | null = null, nearest = Infinity
  for (let row=0;row<=Math.floor((s.rows-3)/3);row++) for (let col=0;col<s.width;col++) {
    const b = {col,row,kind:shot.kind}
    if (s.bubbles.some(item => item.col===col && item.row===row)) continue
    if (row !== 0 && !s.bubbles.some(item => neighbors(item,b))) continue
    const p=center(s,b), d=Math.hypot(p.x-shot.x,p.y-shot.y)
    if (d < nearest) { target=b; nearest=d }
  }
  return target ? settleBubble(s,target) : { ...s, shot:null, over:true }
}
function glyph(paint: Painter, x: number, y: number, value: number) {
  if (paint.bubble) { paint.bubble(x,y,value); return }
  for (let i=0;i<12;i++) { const a=i*Math.PI/6; paint.dot(x+Math.cos(a),y+Math.sin(a),`bubble${value}` as 'bubble0',0.4) }
}

export const bubbleGame: DotGame<BubbleState> = {
  id: 'bubble', title: 'Dot Bubble', help: 'Left/Right: aim · Space: fire · match 3 · P: pause', realtime:true, continuous:false,
  init(cols,rows) {
    const width=Math.max(3,Math.floor((cols-3)/3)), bubbles: Bubble[]=[]
    const initialRows=rows>=17 ? 2 : 1
    for (let row=0;row<initialRows;row++) for (let col=0;col<width;col++) bubbles.push({col,row,kind:col%3})
    return {cols,rows,width,bubbles,angle:-Math.PI/2,loaded:0,next:1,shot:null,shots:0,score:0,over:false,won:false}
  },
  press(s,key) {
    if (s.over || s.shot || key!=='action') return s
    return { ...s, shot: { x:s.cols/2,y:s.rows-2,vx:Math.cos(s.angle)*25,vy:Math.sin(s.angle)*25,kind:s.loaded } }
  },
  update(s,dt,held) {
    if (s.over) return s
    const angle=Math.max(-2.7,Math.min(-0.44,s.angle+((held.has('right')?1:0)-(held.has('left')?1:0))*dt*1.8))
    if (!s.shot) return angle===s.angle ? s : {...s,angle}
    let {x,y,vx,vy}=s.shot
    x+=vx*dt; y+=vy*dt
    if(x<1) {x=2-x;vx=Math.abs(vx)}
    if(x>s.cols-2) {x=2*(s.cols-2)-x;vx=-Math.abs(vx)}
    const next={...s,angle,shot:{...s.shot,x,y,vx,vy}}
    return y<=1.5 || s.bubbles.some(b=>{const p=center(s,b);return Math.hypot(p.x-x,p.y-y)<2.65}) ? attach(next) : next
  },
  draw(s,paint) {
    for(const b of s.bubbles) {const p=center(s,b);glyph(paint,p.x,p.y,b.kind)}
    for(let x=0;x<s.cols;x+=2) paint.dot(x,s.rows-4,'soft',0.3)
    const x=s.cols/2,y=s.rows-2
    if(!s.shot) {
      glyph(paint,x,y,s.loaded)
      for(let d=2;d<6;d++) paint.dot(x+Math.cos(s.angle)*d,y+Math.sin(s.angle)*d,'accent',0.25)
    } else glyph(paint,s.shot.x,s.shot.y,s.shot.kind)
    glyph(paint,2,y,s.next)
  },
  status:s=>({score:s.score,over:s.over,message:s.won?'You win':'Game over'}),
}
