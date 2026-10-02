import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { ensureAIConfigured } from '@/lib/aiEngine'
import { createAIRedactor } from '@/lib/aiRedaction'

export interface PullRequestDraft { title: string; body: string }

const MAX_DIFF_CHARS = 30000

export function parsePullRequestDraft(raw: string): PullRequestDraft {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    const parsed = JSON.parse(cleaned) as { title?: unknown; body?: unknown }
    if (typeof parsed.title === 'string' && parsed.title.trim()) {
      return { title: parsed.title.trim(), body: typeof parsed.body === 'string' ? parsed.body.trim() : '' }
    }
  } catch { /* accept the readable fallback below */ }
  const lines = cleaned.split(/\r?\n/)
  const title = lines.find((line) => line.trim())?.replace(/^#+\s*/, '').trim() ?? ''
  if (!title) throw new Error('AI returned an empty pull request draft.')
  return { title, body: lines.slice(lines.indexOf(lines.find((line) => line.trim()) ?? '') + 1).join('\n').trim() }
}

export async function generatePullRequestDraft(input: { branch: string; base: string; diff: string }): Promise<PullRequestDraft> {
  if (!input.diff.trim()) throw new Error('There are no branch changes to describe.')
  await ensureAIConfigured()
  // Una bozza di PR è testo da pubblicare: i segreti del diff non vanno né al provider né nella bozza.
  const redacted = createAIRedactor().redact(input.diff)
  const diff = redacted.length > MAX_DIFF_CHARS
    ? `${redacted.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated]`
    : redacted
  const system = 'You write precise pull request descriptions from a supplied Git diff. Never invent changes. Return only JSON with string fields "title" and "body". The body must be concise Markdown with Summary and Testing sections.'
  const prompt = `Create a pull request draft for ${input.branch} into ${input.base}.\n\n\u0060\u0060\u0060diff\n${diff}\n\u0060\u0060\u0060`
  return parsePullRequestDraft(await AIEngine.Complete(system, prompt, 1800))
}
