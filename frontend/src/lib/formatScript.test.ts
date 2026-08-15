import { describe, expect, it } from 'vitest'
import { formatJavaScript } from './formatScript'

describe('formatJavaScript', () => {
  it('formats a compact request lifecycle script with readable indentation', async () => {
    const formatted = await formatJavaScript(
      'if(true){pm.test("response is ok",()=>{pm.response.to.have.status(200)})}',
    )

    expect(formatted).toContain('if (true) {')
    expect(formatted).toContain('  pm.test(')
    expect(formatted).toContain('\n')
  })

  it('leaves an empty script untouched', async () => {
    await expect(formatJavaScript('   ')).resolves.toBe('   ')
  })
})
