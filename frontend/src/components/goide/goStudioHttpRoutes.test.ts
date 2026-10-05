import { describe, expect, it } from 'vitest'
import { DEFAULT_GO_BASE_URL, findHttpRoutes, findServerBaseUrl, requestFromRoute, resolveGoBaseUrl, routeAtLine, routeCurl } from './goStudioHttpRoutes'

describe('findHttpRoutes', () => {
  it('reads net/http patterns with and without a method', () => {
    const source = [
      'mux := http.NewServeMux()',
      'mux.HandleFunc("GET /users/{id}", getUser)',
      'mux.HandleFunc("POST /users/{$}", createUser)',
      'http.Handle("/static/", files)',
      'mux.HandleFunc("GET /files/{path...}", serve)',
    ].join('\n')
    expect(findHttpRoutes(source)).toEqual([
      { line: 2, method: 'GET', path: '/users/{id}', anyMethod: false },
      { line: 3, method: 'POST', path: '/users/', anyMethod: false },
      { line: 4, method: 'GET', path: '/static/', anyMethod: true },
      { line: 5, method: 'GET', path: '/files/{path}', anyMethod: false },
    ])
  })

  it('resolves gin and echo groups declared in the same file', () => {
    const source = [
      'r := gin.Default()',
      'api := r.Group("/api")',
      'v1 := api.Group("/v1")',
      'v1.GET("/orders/:id", getOrder)',
      'r.POST("/login", login)',
    ].join('\n')
    expect(findHttpRoutes(source).map((route) => `${route.method} ${route.path}`)).toEqual(['GET /api/v1/orders/:id', 'POST /login'])
  })

  it('reads chi, fiber and gorilla/mux methods', () => {
    const source = [
      'r.Get(`/health`, health)',
      'app.Delete("/items/:id", remove)',
      'router.HandleFunc("/books/{id}", update).Methods("PUT")',
    ].join('\n')
    expect(findHttpRoutes(source).map((route) => `${route.method} ${route.path}`)).toEqual(['GET /health', 'DELETE /items/:id', 'PUT /books/{id}'])
  })

  it('ignores comments, client calls and unknown methods', () => {
    const source = [
      '// r.GET("/commented", h)',
      'resp, _ := http.Get("https://example.com")',
      'mux.HandleFunc("BREW /coffee", brew)',
    ].join('\n')
    expect(findHttpRoutes(source)).toEqual([])
  })
})

describe('findServerBaseUrl', () => {
  it('derives the base URL from the listen address', () => {
    expect(findServerBaseUrl('log.Fatal(http.ListenAndServe(":9090", mux))')).toBe('http://localhost:9090')
    expect(findServerBaseUrl('r.Run("0.0.0.0:3000")')).toBe('http://localhost:3000')
    expect(findServerBaseUrl('srv := &http.Server{Addr: "127.0.0.1:8443"}')).toBe('http://127.0.0.1:8443')
    expect(findServerBaseUrl('e.StartTLS(":8443", cert, key)')).toBe('https://localhost:8443')
    expect(findServerBaseUrl('http.ListenAndServe(addr, nil)')).toBeNull()
  })
})

describe('routeAtLine', () => {
  it('returns only the route registered on the caret line', () => {
    const routes = findHttpRoutes('x\nr.GET("/a", h)\ny')
    expect(routeAtLine(routes, 2)?.path).toBe('/a')
    expect(routeAtLine(routes, 3)).toBeNull()
  })
})

describe('route to API request', () => {
  it('prefers the environment baseUrl, then the listen address, then localhost:8080', () => {
    expect(resolveGoBaseUrl('http.ListenAndServe(":9000", nil)', { baseUrl: 'http://api.local' })).toBe('{{baseUrl}}')
    expect(resolveGoBaseUrl('http.ListenAndServe(":9000", nil)', {})).toBe('http://localhost:9000')
    expect(resolveGoBaseUrl('', {})).toBe(DEFAULT_GO_BASE_URL)
  })

  it('builds a request with method, path parameters and the code origin', () => {
    const [route] = findHttpRoutes('mux.HandleFunc("DELETE /users/{id}", remove)')
    const request = requestFromRoute(route, 'http://localhost:8080', 'api/routes.go:1')
    expect(request.method).toBe('DELETE')
    expect(request.url).toBe('http://localhost:8080/users/{id}')
    expect(request.pathParams?.map((param) => param.key)).toEqual(['id'])
    expect(request.name).toBe('DELETE /users/{id}')
    expect(request.description).toContain('api/routes.go:1')
  })

  it('warns when the handler accepts any method', () => {
    const [route] = findHttpRoutes('http.HandleFunc("/ping", ping)')
    expect(requestFromRoute(route, '{{baseUrl}}', 'main.go:1').description).toContain('accepts any method')
  })
})

describe('routeCurl', () => {
  const route = { line: 3, method: 'POST' as const, path: '/orders/{id}', anyMethod: false }
  it('uses the environment base URL, then the address found in the code', () => {
    expect(routeCurl(route, '', { baseUrl: 'http://api.local:9000/' })).toContain('http://api.local:9000/orders/{id}')
    expect(routeCurl(route, 'http.ListenAndServe(":7070", nil)', {})).toMatch(/curl[\s\S]*-X POST[\s\S]*localhost:7070\/orders/)
  })
})
