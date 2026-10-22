// adOmnia Live Preview bridge. Served by the preview server (static site or dev-server proxy) and
// injected in memory into HTML pages: nothing is ever written to the user's files.
//
// Page -> IDE: window.parent.postMessage({ source: 'adomnia-preview', type, detail }).
// IDE -> page: window.postMessage({ source: 'adomnia-host', type, ... }).
(function () {
  if (window.__adomniaLive) return
  window.__adomniaLive = true

  var parentWindow = window.parent !== window ? window.parent : null
  var autoReload = true

  // Origine dell'IDE che incornicia la pagina: serve sia per indicare il destinatario di
  // postMessage sia per verificare chi manda i comandi (S2819). `ancestorOrigins` è supportato
  // dai webview di adOmnia (WebView2/WebKitGTK); in fallback si impara dal primo messaggio
  // dell'host. Finché non è nota non si manda nulla: mai postMessage verso '*' (S2819).
  var parentOrigin = ''
  try {
    if (location.ancestorOrigins && location.ancestorOrigins.length > 0) parentOrigin = location.ancestorOrigins[0]
    else if (document.referrer) parentOrigin = new URL(document.referrer).origin
  } catch (e) { /* si impara dal primo messaggio dell'host */ }

  function report(type, detail) {
    if (!parentWindow || !parentOrigin) return
    try { parentWindow.postMessage({ source: 'adomnia-preview', type: type, detail: detail }, parentOrigin) } catch (e) { /* the host is gone */ }
  }

  function describe(value) {
    if (typeof value === 'string') return value
    if (value instanceof Error) return value.stack || value.message
    try { return JSON.stringify(value) } catch (e) { return String(value) }
  }

  function refreshStyles() {
    var links = document.querySelectorAll('link[rel~="stylesheet"][href]')
    Array.prototype.forEach.call(links, function (link) {
      var url
      try { url = new URL(link.href, location.href) } catch (e) { return }
      if (url.origin !== location.origin) return
      url.searchParams.set('__adomnia', String(Date.now()))
      var next = link.cloneNode()
      next.href = url.toString()
      next.addEventListener('load', function () { link.remove() })
      next.addEventListener('error', function () { next.remove() })
      link.after(next)
    })
  }

  // Live reload events (static sites). Dev servers do their own HMR and never send these.
  var source = new EventSource('/__adomnia/events')
  source.onmessage = function (message) {
    var event
    try { event = JSON.parse(message.data) } catch (e) { return }
    if (!autoReload) { report('change-ignored', event.paths); return }
    if (event.type === 'css') { refreshStyles(); report('css-updated', event.paths); return }
    if (event.type === 'reload') { report('reloading', event.paths); location.reload() }
  }

  // Commands from the IDE toolbar.
  window.addEventListener('message', function (message) {
    var data = message.data
    if (!data || data.source !== 'adomnia-host' || message.source !== parentWindow) return
    // S2819: l'origine deve essere quella dell'host che incornicia la pagina. Il primo messaggio
    // la insegna se ancestorOrigins/referrer non l'hanno già data.
    if (message.origin) {
      if (!parentOrigin) parentOrigin = message.origin
      else if (message.origin !== parentOrigin) return
    }
    if (data.type === 'reload') location.reload()
    else if (data.type === 'back') history.back()
    else if (data.type === 'forward') history.forward()
    else if (data.type === 'auto-reload') autoReload = data.enabled !== false
    else if (data.type === 'navigate' && typeof data.url === 'string') {
      try { var target = new URL(data.url, location.href); if (target.origin === location.origin) location.assign(target.toString()) } catch (e) { /* ignore */ }
    }
  })

  // Navigation: full loads and client-side routing.
  function navigated() { report('navigated', { url: location.href, title: document.title }) }
  ;['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name]
    history[name] = function () {
      var result = original.apply(history, arguments)
      navigated()
      return result
    }
  })
  window.addEventListener('popstate', navigated)
  window.addEventListener('hashchange', navigated)
  window.addEventListener('load', navigated)

  // Runtime errors, failed assets and console output.
  window.addEventListener('error', function (event) {
    var target = event.target
    if (target && target !== window && (target.src || target.href)) {
      report('asset-error', { tag: target.tagName.toLowerCase(), url: target.src || target.href })
      return
    }
    report('error', { message: event.message, source: event.filename, line: event.lineno, column: event.colno, stack: event.error && event.error.stack })
  }, true)
  window.addEventListener('unhandledrejection', function (event) {
    report('error', { message: 'Unhandled rejection: ' + (event.reason && event.reason.message ? event.reason.message : describe(event.reason)), stack: event.reason && event.reason.stack })
  })
  ;['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
    var original = console[level]
    console[level] = function () {
      try { report('console', { level: level, text: Array.prototype.map.call(arguments, describe).join(' ') }) } catch (e) { /* never break the page */ }
      return original.apply(console, arguments)
    }
  })

  // Network: fetch and XMLHttpRequest, so failed API calls show up next to the page.
  var nativeFetch = window.fetch
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var started = performance.now()
      var method = (init && init.method) || (input && input.method) || 'GET'
      var url = typeof input === 'string' ? input : (input && input.url) || String(input)
      return nativeFetch.apply(this, arguments).then(function (response) {
        report('network', { method: method, url: url, status: response.status, ok: response.ok, ms: Math.round(performance.now() - started) })
        return response
      }, function (error) {
        report('network', { method: method, url: url, status: 0, ok: false, ms: Math.round(performance.now() - started), error: String(error && error.message || error) })
        throw error
      })
    }
  }
  var nativeOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    var started = 0
    this.addEventListener('loadstart', function () { started = performance.now() })
    this.addEventListener('loadend', function () {
      report('network', { method: method, url: String(url), status: this.status, ok: this.status >= 200 && this.status < 400, ms: Math.round(performance.now() - started) })
    })
    return nativeOpen.apply(this, arguments)
  }

  report('ready', { url: location.href, title: document.title })
})()
