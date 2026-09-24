import { deskArt } from './deskAssets'
import { box, glow, line } from './drawing'
import type { Bug } from './level'

const FRAMES = [[36,60,448,392],[520,120,490,335],[1025,25,495,410],[38,490,365,490],[465,495,555,494],[1040,495,480,480]] as const
/** Six authored silhouettes; feet and threat centre stay anchored to the simulation. */
export function drawDeskCritter(ctx: CanvasRenderingContext2D, b: Bug, time: number) {
  const cell = b.encounter === 'legacy' || b.kind === 'deadlock' ? 4 : b.encounter === 'retry' || b.kind === 'race' || b.kind === 'chaser' ? 2 : b.kind === 'leak' ? 1 : b.encounter === 'soap' || b.hover ? 3 : b.kind === 'turret' ? 5 : 0
  const cx=b.x+b.w/2, feet=b.y+b.h, c=b.combat
  const color=['#d38cff','#72f3d8','#ffb679','#bcefff','#ff919f','#ffa46d'][cell]
  ctx.save()
  if(cell===3) ctx.globalAlpha=b.hidden ? .15 : c?.phase==='approach' ? .22 : .8 + Math.sin(time*3)*.12
  if(c?.phase==='entrance')ctx.globalAlpha=Math.max(.2,c.clock/c.duration)
  const walk = cell===0 ? Math.sin(time*10+b.phase)*.045 : cell===1 ? Math.sin(time*2)*.08 : cell===2 ? Math.sin(time*12)*.035 : 0
  const charge = c?.phase==='attack' && c.move===1 ? b.direction*.12 : 0
  const tell = c?.phase==='tell' ? Math.sin(c.clock/c.duration*Math.PI)*.08 : 0
  ctx.translate(cx,feet);ctx.rotate(charge);ctx.scale(1+walk+tell,1-walk-tell)
  if(deskArt.enemies){
    const [x,y,w,h]=FRAMES[cell]
    const width=cell===4 ? b.w*1.45 : cell===2 ? Math.max(90,b.w*1.2) : cell===1 ? b.w*1.2 : cell===5 ? 65 : 62
    const height=cell===4 ? b.h*1.23 : cell===3 ? 64 : cell===1 ? b.h*1.15 : 57
    const scale=Math.min(width/w,height/h)
    if(b.direction<0)ctx.scale(-1,1)
    if(cell===2){
      const cross=Math.sin(time*3)*22
      line(ctx,[-cross,-22,cross,-28],'#ffaa69',2)
      ctx.drawImage(deskArt.enemies,1030,25,265,410,-cross-16,-55,35,55)
      ctx.drawImage(deskArt.enemies,1275,165,245,270,cross-20,-42,39,42)
    }else ctx.drawImage(deskArt.enemies,x,y,w,h,-w*scale/2,-h*scale,w*scale,h*scale)
  }else{
    // A compact face remains legible if a local asset fails to load.
    box(ctx,-b.w/2,-b.h,b.w,b.h,cell===1?16:5,'#183347')
    for(const x of [-8,8])box(ctx,x-3,-b.h*.65,6,8,2,color)
  }
  ctx.restore()
  if(c?.phase==='attack' && b.encounter==='legacy' && c.move===0 && c.clock>=.8){
    ctx.strokeStyle='#ffb46f';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(cx,feet-2,55+(c.clock-.8)*200,8,0,0,Math.PI*2);ctx.stroke()
  }
  if((b.alert??0)>.6){glow(ctx,cx,b.y-12,13,color+'66');line(ctx,[cx,b.y-21,cx,b.y-13],color,3);box(ctx,cx-1.5,b.y-9,3,3,1,color)}
  if(!b.encounter && (b.hp??1)>1)for(let i=0;i<b.hp!;i++)box(ctx,b.x+i*9,b.y-6,6,2,1,color)
}
