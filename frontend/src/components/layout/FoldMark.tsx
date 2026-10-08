import { useEffect, useRef, useState, type ReactNode } from 'react'
import type * as ThreeNS from 'three'

/*
 * FOLD by Ship Notes (MIT, https://github.com/aqualang89/shipnotes-components,
 * motion/fold). The folded-metal surface and its six forms are ported from the
 * original page; here it cycles through the forms on its own, holds "thinking"
 * while a request is in flight. It stays white on purpose: tinted metal reads badly.
 *
 * Shader code: Copyright (c) 2026 Ship Notes. MIT License: permission is hereby
 * granted, free of charge, to any person obtaining a copy of this software, to
 * deal in it without restriction, provided this notice is included. THE
 * SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 */

const DEFORMATION = `
uniform float uTime,uFrom,uTo,uMorph,uExplode;
attribute vec3 param;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vParam;
const float PI=3.14159265359;
const float TAU=6.28318530718;
vec3 form(float mode,vec3 q){
 float s=q.x,v=q.y,j=q.z,th=j*TAU;
 float time=uTime;
 if(mode<.5){
  float r=.37+1.61*s;
  float a=th+1.13*s+v*.039;
  return vec3(r*cos(a),r*sin(a),.38*sin(s*PI)+.16*sin(th*3.+s*4.+time)*s+v*.085*sin(s*PI));
 }
 if(mode<1.5){
  float x=(j-.5)*3.9;
  float amplitude=.56+.5*exp(-x*x*.7)+.28*sin(j*16.-time*5.)*sin(j*PI);
  float y=(s-.5)*3.7*amplitude;
  return vec3(x+v*.022,y,.34*sin(s*TAU+j*5.+time*2.8)+.14*cos(j*15.-time*3.));
 }
 if(mode<2.5){
  float y=(j-.5)*3.1+v*.017;
  float a=s*TAU+y*1.4+time*.3;
  float radius=1.25+.19*cos(y*3.-time);
  return vec3(radius*cos(a),y+.20*sin(a*3.+time),.71*sin(a));
 }
 if(mode<3.5){
  float a=s*TAU;
  float y=(j-.5)*3.2;
  float r=sqrt(max(.05,1.-y*y/3.2))*1.55;
  return vec3(r*cos(a),y+.1*sin(a*3.+time),r*sin(a)*.8)+normalize(vec3(cos(th*12.),sin(th*7.),sin(s*34.)))*uExplode*.24;
 }
 if(mode<4.5){
  float side=j<.5?-1.:1.;
  float k=fract(j*2.);
  float a=(s-.5)*PI*1.6+side*.45;
  float r=.80+k*.30;
  float gap=.50+.40*(.5+.5*sin(time*2.0));
  return vec3(side*gap+r*cos(a)*side,(k-.5)*2.8+v*.022,r*sin(a)*.8);
 }
 float a=s*TAU;
 float r=1.55+v*.035;
 float x=sign(cos(a))*pow(abs(cos(a)),.45)*r;
 float y=sign(sin(a))*pow(abs(sin(a)),.45)*r*.65;
 return vec3(x,y,(j-.5)*.65)+vec3(.1*sin(th),.08*cos(th),0.);
}
vec3 deform(vec3 q){return mix(form(uFrom,q),form(uTo,q),uMorph);}
`

const VERTEX = DEFORMATION + `
void main(){vec3 p=deform(param);vec3 ds=deform(param+vec3(.0003,0.,0.))-deform(param-vec3(.0003,0.,0.));vec3 dv=deform(param+vec3(0.,.001,0.))-deform(param-vec3(0.,.001,0.));vNormal=normalize(mat3(modelMatrix)*cross(ds,dv));vec4 world=modelMatrix*vec4(p,1.);vWorld=world.xyz;vParam=param;gl_Position=projectionMatrix*viewMatrix*world;}
`

const FRAGMENT = `
precision highp float;
uniform vec3 uTint;
uniform float uOpacity;
varying vec3 vWorld,vParam,vNormal;
vec3 studio(vec3 r){
 vec3 c=vec3(.018,.027,.035);
 float strip=pow(max(0.,1.-abs(r.y-.58)*2.9),5.);
 float soft=pow(max(0.,dot(r,normalize(vec3(-.65,.8,.55)))),8.);
 float ribbon=pow(max(0.,1.-abs(r.x*.64+r.y*.74-.12)*8.),3.);
 float copper=pow(max(0.,dot(r,normalize(vec3(.8,-.3,.35)))),12.);
 c+=vec3(.8,.96,1.08)*strip*2.2;
 c+=vec3(.93,1.,1.05)*soft*1.3;
 c+=uTint*ribbon*.82;
 c+=vec3(.92,.40,.15)*copper*.8;
 return c;
}
void main(){
 vec3 n=normalize(vNormal);
 vec3 eye=normalize(cameraPosition-vWorld);
 if(dot(n,eye)<0.)n=-n;
 vec3 r=reflect(-eye,n);
 float fres=pow(1.-max(dot(n,eye),0.),3.);
 float edge=smoothstep(.60,1.,abs(vParam.y));
 vec3 c=studio(r)*mix(.72,1.25,fres)+uTint*.065;
 c+=uTint*edge*.16;
 c*=.985+.015*sin(vParam.x*390.);
 c=c/(c+vec3(.73));c=pow(c,vec3(.4545));
 gl_FragColor=vec4(c,uOpacity);
}
`

const POINTS_VERTEX = DEFORMATION + `
attribute float seed;attribute vec3 target;uniform float uPixel,uScan,uWord;varying float vLight;
void main(){vec3 p=deform(param);p+=vec3(sin(seed*170.+uTime),cos(seed*117.+uTime*.7),sin(seed*92.-uTime))*.021;p=mix(p,target+vec3(sin(seed*170.+uTime*2.),cos(seed*117.+uTime*1.4),0.)*.006,uWord);vec4 world=modelMatrix*vec4(p,1.);vWorld=world.xyz;vParam=param;vec4 mv=viewMatrix*world;gl_Position=projectionMatrix*mv;gl_PointSize=(1.4+seed*1.7)*uPixel*(7.5/-mv.z);float scan=exp(-pow((p.y-uScan)*4.,2.));vLight=.30+seed*.6+scan*1.7;}
`
// On a light page the dust is drawn in the text color (uInk) so it stays visible.
const POINTS_FRAGMENT = `precision highp float;uniform vec3 uTint,uInk;uniform float uOpacity,uDark;varying float vLight;void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;float a=smoothstep(.5,.16,d);vec3 c=mix(mix(uTint,vec3(.88,.98,1.),min(1.,vLight*.6)),uInk,uDark);gl_FragColor=vec4(c,a*uOpacity*mix(vLight,min(1.,.55+vLight*.5),uDark));}`

const STATE_SECONDS = 3.2 // each form holds this long before folding into the next
const WORD_IDLE_SECONDS = 300 // untouched, the wordmark slowly dissolves after five minutes
const WORD_FADE_SECONDS = 4 // that unattended dissolve is slow on purpose
const MORPH_SECONDS = 1.1
const WORD_MORPH_SECONDS = 1.6
const THINKING = 2
const SEARCHING = 3
const WORD = 6 // seventh form: the particles spell the adOmnia wordmark
const FORMS = 6 // the timed cycle; the wordmark is entered and left by clicking
const TAU = Math.PI * 2
// The hexagonal mark (assets/images/adomnia-mark.svg, 512 viewBox) stands in for the "o".
const MARK_PATHS = [
  'M256 68 420 162Q428 167 428 177V331Q428 341 419 346L274 433 295 365 372 320V194L256 127 140 194V320L250 365V442L94 351Q84 345 84 334V177Q84 167 93 162Z',
  'M158 226Q215 228 239 286Q184 285 158 226ZM354 226Q297 228 273 286Q328 285 354 226Z',
]

const clamp = (v: number) => Math.min(1, Math.max(0, v))
// Ease in and out, so every fold starts and lands softly.
const ease = (v: number) => { const x = clamp(v); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }

function ribbons(THREE: typeof ThreeNS) {
  const segments = 80, cross = 4, count = 64, pos: number[] = [], prm: number[] = [], ind: number[] = []
  for (let k = 0; k < count; k++) for (let a = 0; a <= segments; a++) for (let b = 0; b <= cross; b++) { pos.push(0, 0, 0); prm.push(a / segments, b / cross * 2 - 1, k / count) }
  const row = cross + 1, size = (segments + 1) * row
  for (let k = 0; k < count; k++) for (let a = 0; a < segments; a++) for (let b = 0; b < cross; b++) { const n = k * size + a * row + b; ind.push(n, n + 1, n + row, n + 1, n + row + 1, n + row) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('param', new THREE.Float32BufferAttribute(prm, 3))
  g.setIndex(ind)
  return g
}

function particles(THREE: typeof ThreeNS) {
  let rng = 871124
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296 }
  const pos: number[] = [], prm: number[] = [], seed: number[] = []
  for (let i = 0; i < 32768; i++) { pos.push(0, 0, 0); prm.push(random(), random() * 2 - 1, random()); seed.push(random()) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('param', new THREE.Float32BufferAttribute(prm, 3))
  g.setAttribute('seed', new THREE.Float32BufferAttribute(seed, 1))
  g.setAttribute('target', new THREE.Float32BufferAttribute(new Float32Array(32768 * 3), 3))
  return g
}

// Rasterizes "ad" + mark + "mnia" and scatters one particle per sampled pixel.
// ponytail: sampled once per mount; regenerate if the UI font changes while the Hub is open.
function fillWordmark(target: Float32Array, family: string, width: number) {
  const size = 200, markHeight = size * 1.3, k = markHeight / 374, markWidth = 344 * k, gap = size * 0.04
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const font = `800 ${size}px ${family}`
  ctx.font = font
  const ad = ctx.measureText('ad').width, mnia = ctx.measureText('mnia').width
  const total = ad + gap + markWidth + gap + mnia
  canvas.width = Math.ceil(total + 40); canvas.height = Math.ceil(markHeight + 100)
  const baseline = canvas.height - 70
  ctx.font = font
  ctx.fillStyle = '#fff'
  ctx.fillText('ad', 20, baseline)
  ctx.fillText('mnia', 20 + ad + gap + markWidth + gap, baseline)
  ctx.save()
  ctx.translate(20 + ad + gap - 84 * k, baseline + size * 0.2 - 442 * k)
  ctx.scale(k, k)
  for (const d of MARK_PATHS) ctx.fill(new Path2D(d))
  ctx.restore()
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const lit: number[] = []
  for (let y = 0; y < canvas.height; y += 2) for (let x = 0; x < canvas.width; x += 2) if (data[(y * canvas.width + x) * 4 + 3] > 128) lit.push(x, y)
  if (!lit.length) return
  const scale = width / canvas.width
  let rng = 20261008
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296 }
  for (let i = 0; i < target.length / 3; i++) {
    const n = Math.floor(random() * (lit.length / 2)) * 2
    target[i * 3] = (lit[n] + random() * 2 - canvas.width / 2) * scale
    target[i * 3 + 1] = -(lit[n + 1] + random() * 2 - canvas.height / 2) * scale
    target[i * 3 + 2] = (random() - 0.5) * 0.06
  }
}

// Resolves the page text color (any CSS color format) to sRGB 0..1.
function textColor(el: HTMLElement): [number, number, number] {
  const ctx = document.createElement('canvas').getContext('2d')
  const css = getComputedStyle(el).getPropertyValue('--color-text-1').trim()
  if (!ctx || !css) return [0.9, 0.93, 0.96]
  ctx.fillStyle = css
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  return [r / 255, g / 255, b / 255]
}

interface FoldMarkProps {
  /** Holds the "thinking" form while true (e.g. a request in flight). */
  busy: boolean
  /** Shown when WebGL is unavailable. */
  fallback: ReactNode
}

export function FoldMark({ busy, fallback }: FoldMarkProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const busyRef = useRef(busy)
  const [failed, setFailed] = useState(false)
  busyRef.current = busy

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let disposed = false
    let cleanup = () => {}
    void import('three').then((THREE) => {
      if (disposed) return
      let renderer: ThreeNS.WebGLRenderer
      try {
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' })
      } catch {
        setFailed(true)
        return
      }
      renderer.setClearColor(0x000000, 0)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 50)
      camera.position.set(0, 0, 8.5)
      const root = new THREE.Group()
      scene.add(root)
      const tint = new THREE.Color(0xe8f4f8)
      const uniforms = {
        uTime: { value: 0 }, uFrom: { value: 0 }, uTo: { value: 0 }, uMorph: { value: 1 },
        uTint: { value: tint }, uExplode: { value: 0 }, uPixel: { value: 1 }, uOpacity: { value: 1 }, uScan: { value: 0 },
      }
      const pointUniforms = { ...uniforms, uOpacity: { value: 0 }, uWord: { value: 0 }, uInk: { value: new THREE.Color() }, uDark: { value: 0 } }
      const metalGeometry = ribbons(THREE)
      const metalMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: FRAGMENT, side: THREE.DoubleSide, transparent: true })
      const metal = new THREE.Mesh(metalGeometry, metalMaterial)
      metal.frustumCulled = false
      root.add(metal)
      const pointGeometry = particles(THREE)
      const pointMaterial = new THREE.ShaderMaterial({ uniforms: pointUniforms, vertexShader: POINTS_VERTEX, fragmentShader: POINTS_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
      const points = new THREE.Points(pointGeometry, pointMaterial)
      void document.fonts.ready.then(() => {
        if (disposed) return
        const attribute = pointGeometry.getAttribute('target') as ThreeNS.BufferAttribute
        fillWordmark(attribute.array as Float32Array, getComputedStyle(canvas).fontFamily || 'sans-serif', 5.4)
        attribute.needsUpdate = true
      })
      points.frustumCulled = false
      root.add(points)

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = canvas
        if (!w || !h) return
        const ratio = Math.min(2, devicePixelRatio || 1)
        renderer.setPixelRatio(ratio)
        renderer.setSize(w, h, false)
        uniforms.uPixel.value = ratio * 0.5
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(canvas)
      resize()

      // Dark text means a light page: draw the dust in ink with normal blending.
      const syncInk = () => {
        const [r, g, b] = textColor(canvas)
        const dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5
        pointUniforms.uInk.value.setRGB(r, g, b, THREE.SRGBColorSpace)
        pointUniforms.uDark.value = dark ? 1 : 0
        const blending = dark ? THREE.NormalBlending : THREE.AdditiveBlending
        if (pointMaterial.blending !== blending) { pointMaterial.blending = blending; pointMaterial.needsUpdate = true }
      }
      syncInk()
      let frame = 0
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
      const start = performance.now()
      // Opens by gathering the dust into the adOmnia wordmark. A click dissolves it into the
      // cycling forms (and a click on the forms brings it back); untouched, it fades after 5 minutes.
      let from = SEARCHING, to = WORD, changedAt = 0, nextAt = 0, morphSeconds = WORD_MORPH_SECONDS, wordSince = 0, clicked = false, raf = 0
      const go = (next: number, t: number, seconds: number) => {
        from = to; to = next; changedAt = t; nextAt = t + STATE_SECONDS; morphSeconds = reduced ? 0.001 : seconds
        if (next === WORD) wordSince = t
      }
      const onClick = () => {
        clicked = true
        if (reduced) render((performance.now() - start) / 1000)
      }
      canvas.addEventListener('click', onClick)
      let angle = 0, lastT = 0, tiltX = 0, tiltY = 0, aimX = 0, aimY = 0
      // The object leans toward the pointer anywhere on the page (cheap: two smoothed numbers).
      const onPointer = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect()
        aimX = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / r.width))
        aimY = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / r.height))
      }
      const onLeave = () => { aimX = 0; aimY = 0 }
      window.addEventListener('pointermove', onPointer, { passive: true })
      document.addEventListener('pointerleave', onLeave)

      const render = (t: number) => {
        if (clicked) { clicked = false; go(to === WORD ? 0 : WORD, t, WORD_MORPH_SECONDS) }
        else if (to === WORD) { if (t - wordSince >= WORD_IDLE_SECONDS) go(0, t, WORD_FADE_SECONDS) }
        // Forms: hold "thinking" while a request is in flight, otherwise cycle.
        else if (busyRef.current && to !== THINKING) go(THINKING, t, MORPH_SECONDS)
        else if (!busyRef.current && t >= nextAt) go((to + 1) % FORMS, t, MORPH_SECONDS)
        const morph = ease((t - changedAt) / morphSeconds)
        // The wordmark is built from the "searching" cloud, so the shader only knows forms 0..5.
        const shape = (form: number) => (form === WORD ? SEARCHING : form)
        const word = (to === WORD ? morph : 0) + (from === WORD ? 1 - morph : 0)
        if (++frame % 45 === 0) syncInk()
        uniforms.uTime.value = t
        uniforms.uFrom.value = shape(from)
        uniforms.uTo.value = shape(to)
        pointUniforms.uWord.value = word
        uniforms.uMorph.value = morph
        uniforms.uExplode.value = 0.6 + 0.4 * Math.sin(t * 1.8)
        uniforms.uScan.value = 1.7 - ((t * 1.1) % 3.4)
        const isDust = (form: number) => form === SEARCHING || form === WORD
        const dust = (isDust(from) ? 1 - morph : 0) + (isDust(to) ? morph : 0)
        pointUniforms.uOpacity.value = dust * (0.86 + word * 0.14)
        uniforms.uOpacity.value = 1 - dust * 0.98
        metal.visible = uniforms.uOpacity.value > 0.01
        points.visible = dust > 0.01
        // Turning with inertia: it slows while folding and picks up again once the form settles.
        const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t
        angle = (angle + dt * 0.5 * (0.25 + 0.75 * morph)) % TAU
        const follow = Math.min(1, dt * 4)
        tiltX += (aimX - tiltX) * follow; tiltY += (aimY - tiltY) * follow
        const still = 1 - word // the wordmark faces the viewer and only sways gently
        root.rotation.set(
          (0.3 + Math.sin(t * 0.6) * 0.18) * still + Math.sin(t * 0.7) * 0.08 * word + tiltY * 0.3,
          angle + ((angle > Math.PI ? TAU : 0) - angle) * word + Math.sin(t * 0.45) * 0.28 * word + tiltX * 0.45,
          (-0.16 + Math.sin(t * 0.35) * 0.25) * still + Math.sin(t * 0.3) * 0.04 * word,
        )
        const pulse = 1 + Math.exp(-((t - changedAt) % 10) * 6) * 0.06
        root.scale.setScalar(1.12 * pulse)
        renderer.render(scene, camera)
      }

      const tick = (now: number) => {
        render((now - start) / 1000)
        raf = requestAnimationFrame(tick)
      }
      if (reduced) { morphSeconds = 0.001; render(1) }
      else raf = requestAnimationFrame(tick)

      cleanup = () => {
        cancelAnimationFrame(raf)
        observer.disconnect()
        canvas.removeEventListener('click', onClick)
        window.removeEventListener('pointermove', onPointer)
        document.removeEventListener('pointerleave', onLeave)
        metalGeometry.dispose(); metalMaterial.dispose(); pointGeometry.dispose(); pointMaterial.dispose()
        renderer.dispose()
        renderer.forceContextLoss()
      }
    }).catch(() => setFailed(true))
    return () => { disposed = true; cleanup() }
  }, [])

  if (failed) return <>{fallback}</>
  return <canvas ref={canvasRef} className="hub-fold" aria-hidden="true" title="adOmnia"/>
}
