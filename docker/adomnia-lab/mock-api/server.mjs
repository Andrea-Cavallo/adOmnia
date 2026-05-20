import http from 'node:http'

const startedAt = new Date().toISOString()
const name = process.env.ADOMNIA_LAB_NAME || 'adomnia-lab'

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  res.writeHead(status, {
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Demo',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    ...headers,
  })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')

  if (req.method === 'OPTIONS') {
    send(res, 204, '')
    return
  }

  if (url.pathname === '/health') {
    send(res, 200, { ok: true, name, startedAt, now: new Date().toISOString() })
    return
  }

  if (url.pathname === '/json') {
    send(res, 200, {
      ok: true,
      name,
      data: {
        items: [
          { id: 1, name: 'alpha', enabled: true },
          { id: 2, name: 'beta', enabled: false },
        ],
      },
    })
    return
  }

  if (url.pathname === '/slow') {
    const delay = Math.min(Number(url.searchParams.get('ms') || 500), 5000)
    await new Promise((resolve) => setTimeout(resolve, delay))
    send(res, 200, { ok: true, delay })
    return
  }

  if (url.pathname === '/status') {
    const code = Math.min(Math.max(Number(url.searchParams.get('code') || 200), 100), 599)
    send(res, code, { ok: code < 400, code })
    return
  }

  if (url.pathname === '/echo') {
    const raw = await readBody(req)
    let parsed = null
    try {
      parsed = raw ? JSON.parse(raw) : null
    } catch {
      parsed = null
    }
    send(res, 200, {
      ok: true,
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: req.headers,
      raw,
      json: parsed,
    })
    return
  }

  send(res, 404, { ok: false, error: 'not found', path: url.pathname })
})

server.listen(8080, '0.0.0.0', () => {
  console.log(`[adomnia-lab] mock api listening on 8080`)
})
