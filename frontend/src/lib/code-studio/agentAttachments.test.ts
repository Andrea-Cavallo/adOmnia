import { describe, expect, it } from 'vitest'
import { readAgentAttachments } from './agentAttachments'

describe('explicit agent attachments', () => {
  it('reads external UTF-8 source files without attaching their filesystem path', async () => {
    const files = await readAgentAttachments([new File(['print("è")'], 'example.py')], false)
    expect(files).toEqual([{ name: 'example.py', kind: 'text', mimeType: 'text/plain', text: 'print("è")' }])
  })
  it('rejects unsupported images, binary documents and oversized text', async () => {
    await expect(readAgentAttachments([new File(['pixels'], 'shot.png', { type: 'image/png' })], false)).rejects.toThrow('does not accept images')
    await expect(readAgentAttachments([new File(['%PDF-1.7'], 'notes.pdf')], true)).rejects.toThrow('binary format')
    await expect(readAgentAttachments([new File(['x'.repeat(50000)], 'large.txt')], false)).rejects.toThrow('48 KiB')
  })
})
