import { useEffect, useRef } from 'react'
import { SILK_FRAGMENT, SILK_VERTEX } from './silkShaders'

interface SilkProps { speed?: number; scale?: number; color?: string; noiseIntensity?: number; rotation?: number; paused?: boolean }

export default function Silk({ speed = 5, scale = 1, color = '#7B7481', noiseIntensity = 1.5, rotation = 0, paused = false }: SilkProps) {
  const host = useRef<HTMLDivElement>(null)
  const settings = useRef({ speed, scale, color, noiseIntensity, rotation, paused })
  settings.current = { speed, scale, color, noiseIntensity, rotation, paused }
  const refresh = useRef<(() => void) | null>(null)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const canvas = document.createElement('canvas')
    canvas.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none'
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' })
    if (!gl) { element.dataset.silkState = 'fallback'; return }
    const program = gl.createProgram(), buffer = gl.createBuffer()
    const shaders: WebGLShader[] = []
    const destroy = () => {
      if (buffer) gl.deleteBuffer(buffer)
      if (program) gl.deleteProgram(program)
      shaders.forEach(shader => gl.deleteShader(shader))
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
    try {
      if (!program || !buffer) throw new Error('WebGL resources unavailable')
      for (const [type, source] of [[gl.VERTEX_SHADER, SILK_VERTEX], [gl.FRAGMENT_SHADER, SILK_FRAGMENT]] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Shader unavailable')
        shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Silk shader could not compile')
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Silk shader could not link')
      gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
      const position = gl.getAttribLocation(program, 'position')
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    } catch { destroy(); element.dataset.silkState = 'fallback'; return }
    const uniforms = Object.fromEntries(['uTime', 'uSpeed', 'uScale', 'uRotation', 'uNoiseIntensity', 'uColor'].map(name => [name, gl.getUniformLocation(program!, name)]))
    element.appendChild(canvas)
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    let frame = 0, time = 0, previous = 0, rendered = 0, visible = true, disposed = false, lost = false
    const draw = () => {
      if (disposed || lost) return
      const props = settings.current
      const hex = /^#[\da-f]{6}$/i.test(props.color) ? props.color.slice(1) : '7B7481'
      gl.uniform3f(uniforms.uColor, parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4, 6), 16) / 255)
      gl.uniform1f(uniforms.uTime, time); gl.uniform1f(uniforms.uSpeed, props.speed)
      gl.uniform1f(uniforms.uScale, props.scale); gl.uniform1f(uniforms.uRotation, props.rotation)
      gl.uniform1f(uniforms.uNoiseIntensity, props.noiseIntensity)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const running = () => !disposed && !lost && visible && !document.hidden && !motion.matches && !settings.current.paused
    const animate = (stamp: number) => {
      frame = 0
      if (!running()) { element.dataset.silkState = lost ? 'fallback' : 'paused'; return }
      if (previous) time += Math.min((stamp - previous) / 1000, .1) * .1
      previous = stamp
      if (stamp - rendered >= 1000 / 30) { draw(); rendered = stamp }
      frame = requestAnimationFrame(animate)
    }
    const sync = () => {
      cancelAnimationFrame(frame); frame = 0; previous = 0
      element.dataset.silkState = lost ? 'fallback' : running() ? 'running' : 'paused'
      if (running()) frame = requestAnimationFrame(animate); else draw()
    }
    const resize = () => {
      const { width, height } = element.getBoundingClientRect()
      const ratio = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(2_000_000 / Math.max(1, width * height)))
      canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio))
      gl.viewport(0, 0, canvas.width, canvas.height); draw()
    }
    const contextLost = (event: Event) => { event.preventDefault(); lost = true; canvas.style.visibility = 'hidden'; sync() }
    canvas.addEventListener('webglcontextlost', contextLost)
    const size = new ResizeObserver(resize); size.observe(element)
    const intersection = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; sync() }); intersection.observe(element)
    document.addEventListener('visibilitychange', sync); motion.addEventListener('change', sync)
    refresh.current = sync; resize(); sync()
    return () => {
      disposed = true; refresh.current = null; cancelAnimationFrame(frame)
      size.disconnect(); intersection.disconnect(); document.removeEventListener('visibilitychange', sync); motion.removeEventListener('change', sync)
      canvas.removeEventListener('webglcontextlost', contextLost); destroy()
    }
  }, [])
  useEffect(() => { refresh.current?.() }, [speed, scale, color, noiseIntensity, rotation, paused])
  return <div ref={host} data-silk-state="initializing" aria-hidden="true" style={{ width: '100%', height: '100%' }} />
}
