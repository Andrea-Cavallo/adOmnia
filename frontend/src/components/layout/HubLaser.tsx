import { useEffect, useRef } from 'react'

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

/** One beam falling on a horizontal surface. All sizes are CSS pixels, y grows downward. */
const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 size;
uniform float pixelRatio;
uniform float time;
uniform float beamX;
uniform float surfaceY;
uniform float intro;
uniform vec3 tint;
out vec4 fragColor;

float random(vec2 cell) { return fract(sin(dot(cell, vec2(41.3, 289.1))) * 43758.5453); }

float smoke(vec2 point) {
  float total = 0.0;
  float weight = 0.55;
  for (int octave = 0; octave < 4; octave++) {
    vec2 cell = floor(point);
    vec2 part = fract(point);
    vec2 blend = part * part * (3.0 - 2.0 * part);
    total += weight * mix(
      mix(random(cell), random(cell + vec2(1.0, 0.0)), blend.x),
      mix(random(cell + vec2(0.0, 1.0)), random(cell + vec2(1.0, 1.0)), blend.x),
      blend.y);
    point = point * 2.03 + vec2(7.1, 3.7);
    weight *= 0.5;
  }
  return total;
}

float sparks(vec2 point, float gridSize, float threshold) {
  vec2 cell = floor(point / gridSize);
  vec2 center = (cell + 0.2 + 0.6 * vec2(random(cell + 3.0), random(cell + 9.0))) * gridSize;
  float lit = step(threshold, random(cell + 5.0));
  float twinkle = 0.5 + 0.5 * sin(time * 4.0 + random(cell) * 6.28);
  return lit * twinkle * exp(-dot(point - center, point - center) / 1.1);
}

void main() {
  vec2 point = vec2(gl_FragCoord.x, size.y * pixelRatio - gl_FragCoord.y) / pixelRatio;
  float across = abs(point.x - beamX);
  float depth = point.y - surfaceY;
  float front = surfaceY * smoothstep(0.0, 0.55, intro);
  float spreadIn = smoothstep(0.5, 1.0, intro);
  float aboveSurface = 1.0 - smoothstep(-0.5, 0.5, depth);
  float reached = 1.0 - smoothstep(front - 40.0, front + 4.0, point.y);

  vec2 drift = vec2((point.x - beamX) / 110.0 + time * 0.02, point.y / 90.0 - time * 0.07);
  float cloud = smoke(drift);

  float core = 2.6 * exp(-across / 1.15);
  float halo = 0.5 * exp(-across / 9.0) + 0.16 * exp(-across / 42.0);
  vec3 light = (vec3(1.0) * core + tint * halo * (0.75 + 0.7 * cloud)) * aboveSurface * reached;

  // Light opening where the beam lands: a flare rising from the surface, a bright rim running along it.
  float rise = max(-depth, 0.0);
  float reach = 190.0 + 18.0 * sin(time * 0.9);
  float flare = exp(-across / (14.0 + 2.4 * rise)) * exp(-rise / 34.0);
  float rim = exp(-abs(depth) / 1.3) * exp(-across / reach);
  float wash = exp(-rise / 70.0) * exp(-across / 260.0) * aboveSurface;
  float fall = exp(-max(depth, 0.0) / 54.0) * exp(-across / 210.0) * (1.0 - aboveSurface);
  float streak = 0.72 + 0.56 * smoke(vec2(point.x / 26.0, time * 0.22));
  light += spreadIn * (tint * flare * aboveSurface * 1.5 * (0.7 + 0.6 * cloud)
    + mix(tint, vec3(1.0), 0.72) * rim * 3.0
    + tint * wash * 0.2 * cloud
    + tint * fall * 0.34 * streak);

  // Dust carried up the beam, embers scattered along the surface.
  vec2 rising = vec2(point.x - beamX, point.y + time * 16.0);
  light += vec3(1.0) * sparks(rising, 13.0, 0.82) * exp(-across / 46.0) * aboveSurface * reached * 0.75;
  vec2 ember = vec2(point.x + time * 4.0 * sign(point.x - beamX), point.y - time * 7.0);
  light += mix(tint, vec3(1.0), 0.5) * sparks(ember, 15.0, 0.86) * spreadIn * exp(-across / 150.0) * exp(-abs(depth) / 26.0) * 0.8;

  vec3 color = 1.0 - exp(-light);
  fragColor = vec4(color, max(color.r, max(color.g, color.b)));
}`

const DEFAULT_TINT = '#3f52ff'
const FRAME_MS = 1000 / 30
const INTRO_SECONDS = 1.6

/** The theme's accent when it has a hue of its own; the default blue over a white or silver accent. */
export function laserTint(accent: string | undefined): [number, number, number] {
  const hex = accent && /^#[0-9a-f]{6}$/i.test(accent) ? accent : DEFAULT_TINT
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
  const chromatic = Math.max(...channels) - Math.min(...channels) > 0.2
  const chosen = chromatic ? channels : [1, 3, 5].map((start) => Number.parseInt(DEFAULT_TINT.slice(start, start + 2), 16) / 255)
  return [chosen[0], chosen[1], chosen[2]]
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  console.warn('[HubLaser] shader:', gl.getShaderInfoLog(shader))
  gl.deleteShader(shader)
  return null
}

function buildProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
  const program = gl.createProgram()
  if (!vertex || !fragment || !program) return null
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null
}

/**
 * Decorative beam behind the Hub, dark themes only: additive light does not show on white.
 * Without WebGL2 the Hub simply has no effect. It draws at 30 fps at most, stops while the Hub is
 * hidden and shows one still frame under reduced motion.
 */
export function HubLaser() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const page = canvas?.parentElement
    const gl = canvas?.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
    if (!canvas || !page || !gl) return undefined
    const program = buildProgram(gl)
    if (!program) return undefined

    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    // oxlint-disable-next-line react/rules-of-hooks -- WebGL's useProgram, not a React hook
    gl.useProgram(program)
    const uniform = (name: string) => gl.getUniformLocation(program, name)
    const uniforms = { size: uniform('size'), pixelRatio: uniform('pixelRatio'), time: uniform('time'), beamX: uniform('beamX'), surfaceY: uniform('surfaceY'), intro: uniform('intro'), tint: uniform('tint') }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    let last = 0
    let elapsed = 0
    let visible = true
    let enabled = true

    const applyTheme = () => {
      enabled = !document.documentElement.classList.contains('light')
      canvas.style.display = enabled ? '' : 'none'
      gl.uniform3fv(uniforms.tint, laserTint(getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim()))
    }

    const draw = () => {
      const box = canvas.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5)
      const width = Math.max(1, Math.round(box.width * ratio))
      const height = Math.max(1, Math.round(box.height * ratio))
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
        gl.viewport(0, 0, width, height)
      }
      // The beam runs in the gap before the clock and lands on the first section's top edge.
      const clock = page.querySelector('.hub-clock')?.getBoundingClientRect()
      const surface = page.querySelector('.hub-main > section')?.getBoundingClientRect()
      const intro = reducedMotion ? 1 : Math.min(1, elapsed / INTRO_SECONDS)
      gl.uniform2f(uniforms.size, box.width, box.height)
      gl.uniform1f(uniforms.pixelRatio, ratio)
      gl.uniform1f(uniforms.time, elapsed)
      gl.uniform1f(uniforms.beamX, clock && clock.left > box.left ? clock.left - box.left - 12 : box.width * 0.72)
      gl.uniform1f(uniforms.surfaceY, surface ? surface.top - box.top : box.height * 0.4)
      gl.uniform1f(uniforms.intro, intro)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const tick = (now: number) => {
      frame = 0
      if (!visible || !enabled || document.hidden) return
      frame = requestAnimationFrame(tick)
      if (now - last < FRAME_MS) return
      elapsed += last ? Math.min(0.1, (now - last) / 1000) : 0
      last = now
      draw()
    }
    const wake = () => {
      last = 0
      if (reducedMotion) { if (enabled) draw(); return }
      if (!frame) frame = requestAnimationFrame(tick)
    }
    const onTheme = () => { applyTheme(); wake() }

    const intersection = new IntersectionObserver((entries) => {
      visible = entries.some((entry) => entry.isIntersecting)
      if (visible) wake()
    })
    intersection.observe(canvas)
    const resize = new ResizeObserver(() => { if (enabled) draw() })
    resize.observe(canvas)
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('adomnia:theme-tokens', onTheme)
    onTheme()

    return () => {
      cancelAnimationFrame(frame)
      intersection.disconnect()
      resize.disconnect()
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('adomnia:theme-tokens', onTheme)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
    }
  }, [])

  return <canvas ref={canvasRef} className="hub-laser" aria-hidden="true" />
}
