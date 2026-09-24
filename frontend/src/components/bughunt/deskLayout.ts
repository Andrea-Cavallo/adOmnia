import type { Level } from './level'

/** Authored opening: low start, book ascent, PCB crossing, upper cable branch, descent. */
export function buildDeskRoute(map: Level) {
  map.platforms = map.platforms.filter(p => p.x >= 1540 || (!p.floating && p.x+p.w>1540)).map(p=>p.x<1540 ? {...p,x:1540,w:p.x+p.w-1540}:p)
  map.platforms.push(
    {x:0,y:460,w:340,h:100,skin:'key'},
    {x:340,y:510,w:680,h:60,skin:'key'}, // forgiving lower route, visibly below the ascent
    {x:350,y:435,w:100,h:75,skin:'book'},
    {x:450,y:405,w:100,h:105,skin:'book'},
    {x:550,y:375,w:180,h:135,skin:'book'},
    {x:790,y:320,w:200,h:26,floating:true,skin:'ide'},
    {x:925,y:245,w:155,h:24,floating:true,skin:'usb'},
    {x:1020,y:460,w:320,h:100,skin:'key'},
    {x:1340,y:410,w:140,h:150,skin:'book'},
    {x:1480,y:510,w:60,h:50,skin:'key'},
    {x:1510,y:300,w:125,h:24,floating:true,skin:'ide'},
  )
  map.bugs=map.bugs.filter(b=>b.x!==785 && b.kind!=='chaser' && b.kind!=='timeout')
  for(const b of map.bugs){
    if(b.x===650)Object.assign(b,{x:590,y:341,left:565,right:675})
    if(b.kind==='zombie' && b.x<1540)Object.assign(b,{x:1230,y:426,left:1170,right:1280})
    if(b.kind==='flyer' && b.x<1540)Object.assign(b,{x:1410,y:300,homeX:1410,homeY:300,ghost:true,left:1360,right:1460})
    if(b.encounter==='retry')Object.assign(b,{w:78,h:44,y:416})
  }
  map.bugs.push({x:2450,y:424,w:44,h:36,left:2420,right:2525,direction:1,alive:true,phase:0,kind:'leak',hp:2})
  map.powers=[
    {kind:'revert',x:220,y:445},
    {kind:'shield',x:850,y:305},
    {kind:'shuriken',x:1140,y:445},
    {kind:'jump',x:1930,y:260},
    {kind:'sudo',x:2240,y:285},
    {kind:'breakpoint',x:2540,y:445},
    {kind:'heal',x:3180,y:445},
    {kind:'boost',x:4840,y:285},
  ]
  // Code packets sit on deliberate jump arcs and branch landings, not in coin rows.
  map.bits=map.bits.filter(bit=>bit.x>=1540)
  const packets = [[380,400],[480,355],[635,290],[760,275],[960,200],[1040,195],[1370,370],[1515,250]]
  packets.forEach(([x,y],i)=>map.bits.push({id:4000+i,x,y,secret:i===4||i===5}))
  // A collectible must never obscure a power module or appear embedded in solid hardware.
  map.bits=map.bits.filter(bit=>!map.powers.some(p=>Math.abs(bit.x-p.x)<44 && Math.abs(bit.y-p.y)<85)
    && !map.platforms.some(p=>!p.floating && bit.x>p.x-8 && bit.x<p.x+p.w+8 && bit.y>p.y-12 && bit.y<p.y+p.h))
}
