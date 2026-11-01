import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseConsoleLines } from './codeStudioConsoleLines'
import { consoleOutputLines } from './codeStudioConsolePresentation'
import { CodeStudioExecutionDetails } from './CodeStudioExecutionDetails'
import type { GoIDEExecution } from '@/lib/code-studio-api'

describe('shared Run console presentation', () => {
  for (const command of ['go run .', 'java App', 'python app.py', 'node app.js', 'cargo run', 'clang++ main.cpp -o app && app', 'dotnet run', 'ruby app.rb']) {
    it(`shows only program output below the single execution header for ${command}`, () => {
      const lines = parseConsoleLines([
        { stream: 'system', sequence: 0, text: `$ ${command}\n/project\n\n` },
        { stream: 'stdout', sequence: 1, text: 'repeat\nrepeat\n\n' },
        { stream: 'stderr', sequence: 2, text: 'error: real failure\n' },
        { stream: 'system', sequence: 3, text: '\nProcess finished with exit code 1\n' },
      ])
      const output = consoleOutputLines(lines)
      expect(output.map(line => line.text)).toEqual(['repeat', 'repeat', '', 'error: real failure', 'Process finished with exit code 1'])
      expect(output.find(line => line.text.startsWith('error:'))?.stream).toBe('stderr')
      expect(lines.map(line => line.text).join('\n')).toContain(command)
    })
  }
  it('only expands execution details when the search matches metadata', () => {
    const execution = { id: 'run1', command: 'python app.py', workingDirectory: '/project' } as GoIDEExecution
    expect(renderToStaticMarkup(<CodeStudioExecutionDetails execution={execution} search="" />)).not.toContain('open=""')
    expect(renderToStaticMarkup(<CodeStudioExecutionDetails execution={execution} search="python" />)).toContain('open=""')
    expect(renderToStaticMarkup(<CodeStudioExecutionDetails execution={execution} search="Hello" />)).toBe('')
  })
})
