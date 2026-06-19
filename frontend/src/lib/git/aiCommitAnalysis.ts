// AI commit analysis. Builds a prompt from the selected commit's diff and asks
// the existing AIEngine for suggestions. These actions NEVER run Git — they only
// read the diff and return text the user can act on manually.

import * as AIEngine from '@/wailsjs/go/main/AIEngine'
import { ensureAIConfigured } from '@/lib/aiEngine'

export type AiActionId =
  | 'ai.explain'
  | 'ai.summarize'
  | 'ai.risky'
  | 'ai.changelog'
  | 'ai.releaseNotes'
  | 'ai.betterMessage'
  | 'ai.split'
  | 'ai.missingTests'
  | 'ai.genTests'

export interface AiCommitContext {
  subject: string
  body: string
  author: string
  hash: string
  diff: string
}

const MAX_DIFF_CHARS = 24000

const BASE_SYSTEM =
  'You are a senior code reviewer assisting inside adOmnia, a local-first developer toolbox. ' +
  'You only analyze the provided commit diff and return concise, actionable Markdown. ' +
  'You never execute Git commands and never invent changes that are not in the diff.'

const RISK_GUIDANCE =
  'When relevant, explicitly flag: CI/CD changes, dependency changes, authentication or security changes, ' +
  'database migrations, configuration changes, public API changes, missing tests, and unrelated modifications ' +
  'mixed into one commit.'

const PROMPTS: Record<AiActionId, { system: string; instruction: string }> = {
  'ai.explain': { system: BASE_SYSTEM, instruction: 'Explain what this commit does and why, in a short paragraph followed by key bullet points.' },
  'ai.summarize': { system: BASE_SYSTEM, instruction: 'Summarize the changes in 3-6 concise bullet points grouped by area.' },
  'ai.risky': { system: `${BASE_SYSTEM} ${RISK_GUIDANCE}`, instruction: 'Review this commit for risk. List concrete risks with severity (high/medium/low) and a one-line rationale each. If nothing notable, say so.' },
  'ai.changelog': { system: BASE_SYSTEM, instruction: 'Write a single changelog entry for this commit in Keep a Changelog style (Added/Changed/Fixed/Removed).' },
  'ai.releaseNotes': { system: BASE_SYSTEM, instruction: 'Write user-facing release notes for this commit: a one-line headline plus 2-4 bullets in plain language.' },
  'ai.betterMessage': { system: BASE_SYSTEM, instruction: 'Suggest a better Conventional Commits message (type(scope): subject) with an optional body. Return only the suggested message in a code block.' },
  'ai.split': { system: BASE_SYSTEM, instruction: 'If this commit mixes unrelated concerns, suggest how to split it into smaller focused commits, listing which files/hunks go together. If it is already cohesive, say so.' },
  'ai.missingTests': { system: BASE_SYSTEM, instruction: 'Identify behavior introduced or changed by this commit that lacks test coverage. List specific cases that should be tested.' },
  'ai.genTests': { system: BASE_SYSTEM, instruction: 'Generate focused tests for the changed code using the conventions visible in the diff. Return runnable test code in fenced code blocks.' },
}

export function aiActionTitle(id: AiActionId): string {
  return {
    'ai.explain': 'Explain this commit',
    'ai.summarize': 'Summarize changes',
    'ai.risky': 'Detect risky changes',
    'ai.changelog': 'Generate changelog entry',
    'ai.releaseNotes': 'Generate release notes',
    'ai.betterMessage': 'Suggest a better commit message',
    'ai.split': 'Suggest how to split the commit',
    'ai.missingTests': 'Identify missing tests',
    'ai.genTests': 'Generate tests for changed code',
  }[id]
}

/** Run an AI analysis action against a commit's diff and return Markdown text. */
export async function runAiCommitAnalysis(action: AiActionId, ctx: AiCommitContext): Promise<string> {
  const prompt = PROMPTS[action]
  if (!prompt) throw new Error(`Unknown AI action: ${action}`)
  if (!ctx.diff.trim()) throw new Error('This commit has no textual diff to analyze.')

  await ensureAIConfigured()

  const diff = ctx.diff.length > MAX_DIFF_CHARS
    ? `${ctx.diff.slice(0, MAX_DIFF_CHARS)}\n\n…diff truncated (${ctx.diff.length - MAX_DIFF_CHARS} more characters)…`
    : ctx.diff

  const user = [
    prompt.instruction,
    '',
    `Commit: ${ctx.hash}`,
    `Author: ${ctx.author}`,
    `Subject: ${ctx.subject}`,
    ctx.body ? `Body:\n${ctx.body}` : '',
    '',
    'Unified diff:',
    '```diff',
    diff,
    '```',
  ].filter(Boolean).join('\n')

  return (await AIEngine.Complete(prompt.system, user, 2048)).trim()
}
