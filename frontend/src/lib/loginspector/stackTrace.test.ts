import { describe, expect, it } from 'vitest'
import { frameCandidates, parseStackTrace } from './stackTrace'

const JAVA = `java.lang.NullPointerException: order is null
	at com.acme.orders.OrderService.create(OrderService.java:42)
	at org.springframework.web.servlet.DispatcherServlet.doDispatch(DispatcherServlet.java:1071)
	at java.base/java.lang.Thread.run(Thread.java:840)
Caused by: java.sql.SQLException: connection closed
	at com.acme.orders.OrderRepository.save(OrderRepository.java:88)
	... 12 more`

const GO = `panic: runtime error: invalid memory address
goroutine 17 [running]:
adomnia/internal/orders.(*Service).Create(0xc000102000)
	/home/ci/app/internal/orders/service.go:57 +0x1f
net/http.(*conn).serve(0xc0000b8000)
	/usr/local/go/src/net/http/server.go:1802 +0x1a3`

describe('parseStackTrace', () => {
  it('separates the Caused by chain and counts elided frames', () => {
    const parsed = parseStackTrace(JAVA)
    expect(parsed.language).toBe('java')
    expect(parsed.sections).toHaveLength(2)
    expect(parsed.sections[1].title).toContain('Caused by')
    expect(parsed.sections[1].elided).toBe(12)
    expect(parsed.frameCount).toBe(4)
  })

  it('marks framework frames without hiding them', () => {
    const frames = parseStackTrace(JAVA).sections.flatMap((section) => section.frames)
    expect(frames.map((frame) => frame.origin)).toEqual(['application', 'framework', 'framework', 'application'])
    expect(frames[1].originReason).toContain('org.springframework.')
  })

  it('pairs a Go function line with the location line below it', () => {
    const parsed = parseStackTrace(GO)
    expect(parsed.language).toBe('go')
    const frames = parsed.sections.flatMap((section) => section.frames)
    expect(frames[0]).toMatchObject({ file: '/home/ci/app/internal/orders/service.go', line: 57, origin: 'application' })
    expect(frames[1]).toMatchObject({ origin: 'framework', originReason: 'Go standard library' })
  })

  it('reads javascript and python frames', () => {
    const js = parseStackTrace('Error: boom\n    at handler (/srv/app/src/index.js:10:5)')
    expect(js.sections[0].frames[0]).toMatchObject({ function: 'handler', file: '/srv/app/src/index.js', line: 10 })
    const py = parseStackTrace('Traceback (most recent call last):\n  File "/srv/app/main.py", line 12, in handler')
    expect(py.sections[0].frames[0]).toMatchObject({ file: '/srv/app/main.py', line: 12, function: 'handler' })
  })
})

describe('frameCandidates', () => {
  it('offers path suffixes, longest first, for a build-machine path', () => {
    const frame = parseStackTrace(GO).sections[0].frames[0]
    expect(frameCandidates(frame).slice(0, 2)).toEqual([
      'home/ci/app/internal/orders/service.go',
      'ci/app/internal/orders/service.go',
    ])
  })

  it('rebuilds the package directory for a bare java file name', () => {
    const frame = parseStackTrace(JAVA).sections[0].frames[0]
    expect(frameCandidates(frame)).toEqual(['com/acme/orders/OrderService.java', 'OrderService.java'])
  })
})
