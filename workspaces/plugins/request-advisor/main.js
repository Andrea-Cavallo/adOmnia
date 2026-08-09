export function prepareRequest(input) {
  const url = String(input.payload.url || '')
  if (/^(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)) {
    input.payload.url = `http://${url}`
  }
  input.payload.headers['X-Adomnia-Plugin'] = adomnia.settings.headerValue
  return { modified: true, data: input.payload }
}

export function inspect() {
  adomnia.log.info('Request Advisor inspect action executed')
  adomnia.ui.notify({
    title: 'Request Advisor',
    message: 'Inspect action completed',
    type: 'success',
  })
  return {
    ok: true,
    pluginId: adomnia.pluginId,
    headerValue: adomnia.settings.headerValue,
  }
}
