import { deskArt, drawCast } from './deskAssets'
import { heroPose } from './heroAnimation'
import { drawDeskCritter } from './deskCritters'
import { box, glow, line, text } from './drawing'
import type { Bug, Platform } from './level'
import type { PlayerVisual } from './visuals'

export function drawDeskBackground(ctx: CanvasRenderingContext2D, camera: number): boolean {
  const image = deskArt.background
  if (!image) return false
  // Overscan the painting: slow parallax without mirrored lettering or visible seams.
  ctx.drawImage(image, -camera * 0.13, -80, 1660, 790)
  const shade = ctx.createLinearGradient(0, 260, 0, 540)
  shade.addColorStop(0, '#07112408'); shade.addColorStop(1, '#040916dd')
  ctx.fillStyle = shade; ctx.fillRect(0, 0, 960, 540)
  return true
}

/** Collision top is exactly p.y; bevels and supports extend downwards only. */
export function drawDeskPlatform(ctx: CanvasRenderingContext2D, p: Platform, t: number) {
  ctx.save()
  if (p.crumble) ctx.translate(Math.sin(t * 38) * 1.5, 0)
  const book = (p.floating || p.y < 460) && p.skin === 'book'
  const h = book ? p.h : p.floating ? p.h : Math.min(p.h, 85)
  const wood = !p.floating && !book
  const body = ctx.createLinearGradient(0, p.y, 0, p.y + h)
  for (const [stop, color] of (wood
    ? [[0, '#d1a16b'], [.07, '#90613c'], [.22, '#513525'], [.8, '#32221e'], [1, '#101522']]
    : book ? [[0, '#b2a58c'], [.14, '#586c80'], [.24, '#d3baa0'], [.77, '#b09a83'], [1, '#354352']]
      : [[0, '#8a8b9b'], [.12, '#4d4c60'], [.65, '#292938'], [1, '#111824']]) as [number, string][]) body.addColorStop(stop, color)
  box(ctx, p.x, p.y, p.w, h, wood ? 2 : 5, body)
  ctx.save(); ctx.beginPath(); ctx.rect(p.x + 2, p.y + 3, p.w - 4, h - 5); ctx.clip()
  if (deskArt.materials) {
    // Interior samples contain only material. The studio backdrop is never drawn.
    const source = wood ? [33, 288, 653, 115] : book ? [80, 608, 530, 62]
      : p.skin === 'usb' ? [1020, 698, 296, 107] : [1170, 249, 180, 66]
    const tile = wood ? 330 : p.w
    for (let x = p.x; x < p.x + p.w; x += tile) {
      const width = Math.min(tile, p.x + p.w - x)
      ctx.drawImage(deskArt.materials, source[0], source[1], source[2] * width / tile, source[3], x, p.y + 2, width, h - 2)
    }
  }
  if (wood || book) {
    for (let i = 0; i < h; i += wood ? 4 : 3) {
      const wobble = Math.sin(i * 12.7 + p.x) * 3
      line(ctx, [p.x, p.y + i + 5, p.x + p.w * .45, p.y + i + wobble + 5, p.x + p.w, p.y + i + 6], wood ? '#e0ab6a20' : '#504f5750', 1)
    }
  } else {
    box(ctx, p.x + 5, p.y + 3, p.w - 10, Math.max(8, h - 9), 4, '#74748733')
    line(ctx, [p.x + 6, p.y + h - 4, p.x + p.w - 6, p.y + h - 4, p.x + p.w - 4, p.y + 5], '#080d1c', 2)
    // Printed circuit traces and sockets identify hardware without labels.
    if (p.skin === 'ide' || p.skin === 'usb') {
      for (let x=p.x+12;x<p.x+p.w-12;x+=24) {
        line(ctx,[x,p.y+4,x,p.y+h-6,x+12,p.y+h-6],'#72d1bd88',1)
        box(ctx,x-2,p.y+6,6,5,1,'#101c2a')
      }
    }
    // Deterministic scuffs: no per-frame random texture flicker.
    for (let i = 0; i < p.w / 8; i++) {
      const x = p.x + ((i * 47 + 13) % Math.max(1, p.w - 8))
      const y = p.y + 4 + (i * 13 % Math.max(1, h - 8))
      line(ctx, [x, y, x + 2, y + 1], '#d2c5b030', .7)
    }
  }
  ctx.restore()
  if (book && h >= 50) {
    for (let y = 0, i = 0; y < h; y += 27, i++) {
      box(ctx, p.x + 4, p.y + y + 3, p.w - 8, Math.min(24, h - y - 3), 2, i % 2 ? '#17273beb' : '#253348eb')
      line(ctx, [p.x + 15, p.y + y + 4, p.x + 15, p.y + Math.min(h - 1, y + 25)], '#beaa8180', 2)
      line(ctx,[p.x+25,p.y+y+8,p.x+p.w-12,p.y+y+8],'#cfb99c55',1)
    }
  }
  line(ctx, [p.x + 2, p.y + .5, p.x + p.w - 2, p.y + .5], p.unstable ? '#ffd095' : wood ? '#f3c991' : '#a9d4ff', 1.5)
  if (p.floating && p.skin === 'usb') {
    const anchorX = (p.originX ?? p.x) + p.w / 2, anchorY = (p.originY ?? p.y) - 88
    ctx.beginPath(); ctx.moveTo(anchorX, anchorY); ctx.quadraticCurveTo(anchorX + 35, p.y - 20, p.x + p.w / 2, p.y + 4)
    ctx.strokeStyle = '#080d19'; ctx.lineWidth = 7; ctx.stroke(); ctx.strokeStyle = '#627186'; ctx.lineWidth = 1; ctx.stroke()
  }
  if (p.floating && p.skin !== 'usb') {
    for (const x of [p.x+14,p.x+p.w-24]) { box(ctx,x,p.y+h,10,Math.min(80,540-p.y-h),2,'#12202d'); box(ctx,x-4,p.y+h-3,18,12,2,'#293b4b'); glow(ctx,x+5,p.y+h+5,7,'#59cdff44') }
  }
  if (wood) {
    for (let x = p.x + 65; x < p.x + p.w - 50; x += 235) {
      ctx.beginPath(); ctx.moveTo(x, p.y + 28); ctx.bezierCurveTo(x - 15, p.y + 145, x + 80, p.y + 135, x + 54, p.y + 38)
      ctx.strokeStyle = '#090f19'; ctx.lineWidth = 9; ctx.stroke(); ctx.strokeStyle = '#616174'; ctx.lineWidth = 1; ctx.stroke()
      box(ctx, x - 6, p.y + 18, 12, 23, 2, '#151d2a')
    }
  }
  ctx.restore()
}

export function drawDeskHero(ctx: CanvasRenderingContext2D, p: PlayerVisual, t: number, reduced: boolean): boolean {
  if (!deskArt.cast) return false
  const pose = heroPose(p, reduced)
  const cx = p.x + p.w / 2, feet = p.y + p.h
  ctx.save()
  // Foot-anchored deformation: the visible landing stays on the collision surface.
  ctx.translate(cx - p.facing * pose.recoil, feet + pose.lift)
  ctx.rotate(pose.rotation); ctx.scale(pose.xScale * (p.crouch ? 1.08 : 1), pose.yScale * (p.crouch ? .63 : 1)); ctx.translate(-cx, -feet)
  if (p.invulnerable > 0) ctx.globalAlpha = .6 + Math.sin(t * 18) * .2
  if ((p.dash ?? 0) > 0) line(ctx, [p.x + 17 - p.facing * 65, p.y + 22, p.x + 17, p.y + 22], '#6eeaff88', 8)
  glow(ctx, p.x + 17, p.y + 27, 35, '#2f8dff22')
  drawCast(ctx, pose.cell, cx, feet, 65, 70, p.facing < 0)
  if (pose.curious) {
    text(ctx, '?', cx + p.facing * 26, p.y - 24, '#a4eaff', 12)
    glow(ctx, cx, p.y - 14, 12, '#59ceff22')
  }
  ctx.restore()
  return true
}

export function drawDeskEnemy(ctx: CanvasRenderingContext2D, b: Bug, t: number): boolean {
  drawDeskCritter(ctx, b, t)
  return true
}

export function drawDeskNote(ctx: CanvasRenderingContext2D, x: number, y: number, title: string, hint: string) {
  ctx.save(); ctx.translate(x, y)
  box(ctx, 3, 4, 235, 62, 1, '#050b1944')
  const paper = ctx.createLinearGradient(0, 0, 0, 62); paper.addColorStop(0, '#dec896'); paper.addColorStop(1, '#b49c6d')
  box(ctx, 0, 0, 235, 62, 1, paper)
  box(ctx, 85, -4, 60, 12, 0, '#e0d5b970')
  text(ctx, title, 12, 27, '#302c30', 12)
  text(ctx, hint, 12, 46, '#403b3e', 9)
  ctx.restore()
}
