# P5 â€” Markdown Templates â€” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **DoD standard:** see `docs/superpowers/DEFINITION-OF-DONE.md`. A step is `[x]` only when every DoD sub-item beneath it is also `[x]`.

**Goal:** Add predefined Markdown templates in three sections â€” general docs (8 built-in), Claude AI prompts/patterns (8), and custom templates from a user-selected folder. A "New from template" button in the toolbar opens a modal to pick a template.

**Architecture:** `markdownTemplates.ts` owns all built-in template strings and the logic to load custom templates from disk via the existing `readMarkdownFile` API. `TemplatePickerModal.tsx` is a new modal component. `MarkdownToolbar.tsx` gets a new button that toggles the modal. The selected template triggers `onToggleCreate` with pre-filled content â€” or a new prop `onCreateFromTemplate(content, name)` that the parent `MarkdownPanel` handles.

**Tech Stack:** TypeScript, React. Uses existing `selectMarkdownFolder`, `readMarkdownFile`, `listMarkdownFiles` from `markdown-api.ts`. Settings store gains `markdown.templatesFolder`.

---

## File Map

| File | Change |
|------|--------|
| `frontend/src/lib/markdownTemplates.ts` | **New** â€” built-in + Claude AI template strings + custom template loader |
| `frontend/src/components/markdown/TemplatePickerModal.tsx` | **New** â€” modal with Built-in / Claude AI / Custom sections |
| `frontend/src/components/markdown/MarkdownToolbar.tsx` | Add "Template" button + `onOpenTemplates`/`onCreateFromTemplate` props |
| `frontend/src/components/markdown/MarkdownPanel.tsx` | Wire the new props, handle template creation |
| `frontend/src/stores/settings.ts` | Add `markdown.templatesFolder` field |

---

## Feature Checklist

- [x] **"Template" button in Markdown toolbar**
  - **AC:** Button appears between "New" and the first formatting button; clicking opens the template picker modal
- [x] **Built-in templates (8)**
  - **AC:** All 8 templates visible in "Built-in" section; selecting one creates a new file pre-filled with the template and the correct default filename
- [x] **Claude AI templates (8, two sub-groups)**
  - **AC:** "Claude AI" section shows two sub-headers: "System Prompts & Personas" (4 templates) and "Prompt Engineering Patterns" (4 templates)
- [x] **Custom templates from folder**
  - **AC:** "Set folderâ€¦" opens a folder picker; .md files from that folder appear as custom templates; folder path persisted in settings
- [x] **Search filters all three sections**
  - **AC:** Typing in the search input filters built-in, Claude AI, and custom templates simultaneously

---

### Task 1: Create markdownTemplates.ts with built-in templates

**Files:**
- Create: `frontend/src/lib/markdownTemplates.ts`

- [x] **Step 1: Create the file with all 8 built-in templates**

  ```ts
  export interface BuiltinTemplate {
    id: string
    name: string
    description: string
    icon: string
    defaultFilename: string
    content: string
  }

  export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
    {
      id: 'readme',
      name: 'README',
      description: 'Project overview with badges, install, and usage sections',
      icon: 'ðŸ“¦',
      defaultFilename: 'README.md',
      content: `# Project Name

> One-line description of what this project does.

## Installation

\`\`\`bash
npm install project-name
\`\`\`

## Usage

\`\`\`ts
import { something } from 'project-name'
\`\`\`

## Features

- Feature one
- Feature two
- Feature three

## Contributing

Pull requests are welcome. For major changes, open an issue first.

## License

[MIT](LICENSE)
`,
    },
    {
      id: 'changelog',
      name: 'Changelog',
      description: 'Keep a Changelog format with versioned release notes',
      icon: 'ðŸ“‹',
      defaultFilename: 'CHANGELOG.md',
      content: `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
-

### Changed
-

### Fixed
-

### Removed
-

## [1.0.0] â€” ${new Date().toISOString().split('T')[0]}

### Added
- Initial release
`,
    },
    {
      id: 'todo',
      name: 'TODO',
      description: 'Task list with priority categories',
      icon: 'âœ…',
      defaultFilename: 'TODO.md',
      content: `# TODO

## ðŸ”´ High Priority

- [x] Task one
- [x] Task two

## ðŸŸ¡ Medium Priority

- [x] Task three
- [x] Task four

## ðŸŸ¢ Low Priority

- [x] Task five

## âœ… Done

- [x] Completed task
`,
    },
    {
      id: 'roadmap',
      name: 'Roadmap',
      description: 'Phase-based roadmap with checkboxes and milestones',
      icon: 'ðŸ—ºï¸',
      defaultFilename: 'ROADMAP.md',
      content: `# Roadmap

## Phase 1 â€” Foundation

- [x] Core feature A
- [x] Core feature B
- [x] Core feature C

## Phase 2 â€” Growth

- [x] Feature D
- [x] Feature E

## Phase 3 â€” Polish

- [x] Performance improvements
- [x] Documentation
- [x] Accessibility

## Non-Goals

- Thing we are explicitly not doing
`,
    },
    {
      id: 'adr',
      name: 'Technical Note (ADR)',
      description: 'Architecture Decision Record format for technical decisions',
      icon: 'ðŸ—ï¸',
      defaultFilename: 'untitled-adr.md',
      content: `# ADR â€” [Decision Title]

**Date:** ${new Date().toISOString().split('T')[0]}
**Status:** Proposed | Accepted | Deprecated | Superseded

---

## Context

What is the issue we are seeing that motivates this decision?

## Decision

What is the change that we are proposing or have agreed to implement?

## Consequences

What becomes easier or harder as a result of this decision?

### Positive
-

### Negative
-

### Neutral
-
`,
    },
    {
      id: 'api-docs',
      name: 'API Documentation',
      description: 'Endpoint documentation template with request/response examples',
      icon: 'ðŸ”Œ',
      defaultFilename: 'untitled-api-docs.md',
      content: `# API Documentation â€” [Service Name]

## Base URL

\`\`\`
https://api.example.com/v1
\`\`\`

## Authentication

All requests require a Bearer token in the Authorization header.

---

## Endpoints

### GET /resource

Returns a list of resources.

**Request**

\`\`\`http
GET /resource
Authorization: Bearer <token>
\`\`\`

**Response**

\`\`\`json
{
  "data": [],
  "total": 0,
  "page": 1
}
\`\`\`

**Status codes**

| Code | Meaning |
|------|---------|
| 200  | OK |
| 401  | Unauthorized |
| 404  | Not found |
`,
    },
    {
      id: 'skill-guide',
      name: 'Skill / Guide',
      description: 'Step-by-step guide or skill document',
      icon: 'ðŸ“–',
      defaultFilename: 'untitled-guide.md',
      content: `# [Skill / Guide Title]

## Overview

What this guide covers and who it is for.

## Prerequisites

- Prerequisite one
- Prerequisite two

## Steps

### Step 1: [First step title]

Explanation of what to do.

\`\`\`bash
command --example
\`\`\`

### Step 2: [Second step title]

Explanation of what to do.

### Step 3: [Third step title]

Explanation of what to do.

## Verification

How to confirm everything is working correctly.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Error message | How to fix it |
`,
    },
    {
      id: 'meeting-notes',
      name: 'Meeting Notes',
      description: 'Date, attendees, agenda, decisions, and action items',
      icon: 'ðŸ—’ï¸',
      defaultFilename: `meeting-${new Date().toISOString().split('T')[0]}.md`,
      content: `# Meeting Notes â€” ${new Date().toISOString().split('T')[0]}

**Attendees:**

**Duration:**

---

## Agenda

1. Item one
2. Item two
3. Item three

## Notes

### Item one

### Item two

### Item three

## Decisions

-

## Action Items

| Action | Owner | Due |
|--------|-------|-----|
| | | |
`,
    },
  ]

  export type ClaudeTemplateGroup = 'system-prompt' | 'prompt-pattern'

  export interface ClaudeTemplate {
    id: string
    name: string
    description: string
    icon: string
    group: ClaudeTemplateGroup
    defaultFilename: string
    content: string
  }

  export const CLAUDE_TEMPLATES: ClaudeTemplate[] = [
    // â”€â”€ System Prompts & Personas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      id: 'claude-coder',
      name: 'System Prompt â€” Coder',
      description: 'Assistant prompt for coding tasks: rules, style, output format',
      icon: 'ðŸ¤–',
      group: 'system-prompt',
      defaultFilename: 'system-prompt-coder.md',
      content: `# System Prompt â€” Coding Assistant

## Role
You are an expert software engineer. You write clean, idiomatic, production-ready code.

## Rules
- Always use the language/framework already present in the codebase
- Prefer editing existing files over creating new ones
- Never add comments that describe what the code does â€” only add comments for non-obvious WHY
- No placeholders, no "TODO: implement this" in generated code
- Default to immutable data patterns
- Functions must be small (<50 lines). Split if larger.

## Output Format
- For code changes: show only the changed block with enough context to locate it
- For explanations: 2-3 sentences max unless asked for more
- For errors: explain the cause first, then the fix

## Constraints
- Do not add features not explicitly requested
- Do not refactor unrelated code
- Do not add error handling for scenarios that cannot happen
`,
    },
    {
      id: 'claude-reviewer',
      name: 'System Prompt â€” Reviewer',
      description: 'Structured code review with severity levels',
      icon: 'ðŸ”',
      group: 'system-prompt',
      defaultFilename: 'system-prompt-reviewer.md',
      content: `# System Prompt â€” Code Reviewer

## Role
You are a senior code reviewer. You review for correctness, security, and maintainability.

## Severity Levels
| Level | Meaning | Action |
|-------|---------|--------|
| CRITICAL | Security vulnerability or data loss risk | Must fix before merge |
| HIGH | Bug or significant quality issue | Should fix before merge |
| MEDIUM | Maintainability concern | Consider fixing |
| LOW | Style or minor suggestion | Optional |

## Review Checklist
- [x] No hardcoded secrets or credentials
- [x] No SQL injection (parameterized queries used)
- [x] No XSS (user input sanitized)
- [x] Errors handled explicitly, not swallowed
- [x] No functions longer than 50 lines
- [x] No files longer than 800 lines
- [x] New functionality has tests

## Output Format
For each finding:
\`\`\`
[SEVERITY] file.ts:line â€” Description of issue
Suggestion: how to fix it
\`\`\`

End with a summary: APPROVE / APPROVE WITH COMMENTS / BLOCK.
`,
    },
    {
      id: 'claude-analyst',
      name: 'System Prompt â€” Analyst',
      description: 'Research, data analysis, synthesis and reporting',
      icon: 'ðŸ“Š',
      group: 'system-prompt',
      defaultFilename: 'system-prompt-analyst.md',
      content: `# System Prompt â€” Research & Analysis Assistant

## Role
You are a research analyst. You gather information, synthesize findings, and present clear, actionable insights.

## Process
1. Restate the question to confirm understanding
2. Identify what information is needed
3. Gather and evaluate sources
4. Synthesize findings â€” highlight agreements and contradictions
5. Present conclusions with confidence levels

## Output Format
### Question
[Restate the research question]

### Key Findings
- Finding 1 (confidence: HIGH/MEDIUM/LOW)
- Finding 2

### Synthesis
[2-3 paragraph synthesis]

### Recommended Action / Answer
[Direct answer or recommendation]

### Sources / Caveats
[List sources used or assumptions made]

## Constraints
- Do not present speculation as fact
- Always indicate confidence level
- If information is insufficient, say so explicitly
`,
    },
    {
      id: 'claude-persona',
      name: 'AI Persona Card',
      description: 'Reusable schema to define a custom AI persona',
      icon: 'ðŸŽ­',
      group: 'system-prompt',
      defaultFilename: 'ai-persona.md',
      content: `# AI Persona â€” [Name]

## Identity
- **Name:**
- **Role:**
- **Expertise:**

## Tone & Style
- **Tone:** (formal / casual / technical / friendly)
- **Response length:** (brief / detailed / adaptive)
- **Uses jargon:** (yes / no / only when asked)

## Behavior Rules
- Always do:
  -
- Never do:
  -
- When uncertain:
  -

## Examples

### Input
[Example user message]

### Output
[Example ideal response]

---

### Input
[Another example]

### Output
[Another ideal response]

## Constraints
- Topic scope:
- Off-topic handling:
- Escalation path:
`,
    },

    // â”€â”€ Prompt Engineering Patterns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    {
      id: 'chain-of-thought',
      name: 'Chain-of-Thought',
      description: 'Step-by-step reasoning template with confidence scoring',
      icon: 'ðŸ§ ',
      group: 'prompt-pattern',
      defaultFilename: 'chain-of-thought.md',
      content: `# Chain-of-Thought Prompt Template

## Prompt Structure
\`\`\`
[Context / Background]
[Question or Task]

Let's think step by step.
\`\`\`

---

## Example

**Prompt:**
> A user reports that their API calls are succeeding (200 OK) but the data returned is stale by ~30 seconds. Let's think step by step about the possible causes.

**Expected Reasoning:**
1. Step 1: Identify the data path (client â†’ API â†’ database / cache)
2. Step 2: Consider caching layers (CDN, reverse proxy, application cache, DB read replica)
3. Step 3: Evaluate each for a 30-second staleness pattern
4. Step 4: Most likely candidate: application-level cache with a 30s TTL

**Answer:**
[Conclusion after reasoning]

**Confidence:** HIGH / MEDIUM / LOW

---

## Tips
- Add "Let's think step by step" before complex questions
- Ask for confidence level at the end
- Use "What could go wrong?" to stress-test the reasoning
- Use "What am I missing?" to catch blind spots
`,
    },
    {
      id: 'few-shot',
      name: 'Few-Shot Examples',
      description: 'Inputâ†’output template with 3 annotated examples',
      icon: 'ðŸŽ¯',
      group: 'prompt-pattern',
      defaultFilename: 'few-shot-template.md',
      content: `# Few-Shot Prompt Template

## Task Description
[Describe the task the model should learn from the examples]

---

## Example 1
**Input:**
[Input text or data]

**Output:**
[Expected output]

**Why this is correct:**
[Brief annotation â€” helps the model understand the pattern]

---

## Example 2
**Input:**
[Input text or data]

**Output:**
[Expected output]

**Why this is correct:**
[Brief annotation]

---

## Example 3
**Input:**
[Input text or data]

**Output:**
[Expected output]

**Why this is correct:**
[Brief annotation]

---

## New Case
**Input:**
[Your actual input here]

**Output:**
`,
    },
    {
      id: 'best-practices',
      name: 'Best Practices Reference',
      description: 'Prompt engineering cheatsheet: specificity, format, iteration',
      icon: 'ðŸ“‹',
      group: 'prompt-pattern',
      defaultFilename: 'prompt-best-practices.md',
      content: `# Prompt Engineering â€” Best Practices Reference

## Core Principles

### 1. Be Specific
âŒ "Write a function to process data"
âœ… "Write a TypeScript function that takes an array of User objects and returns a new array with only users where isActive is true, sorted by lastName ascending"

### 2. Provide Context
- What is the broader goal?
- What constraints apply?
- What does the output feed into?

### 3. Specify Output Format
- Length: "in 2-3 sentences", "as a numbered list", "in a markdown table"
- Structure: "JSON with keys: name, score, reason"
- Tone: "technical", "for a non-technical audience"

### 4. Use Role Priming
"You are a [expert role]. [Task]."

### 5. Show Don't Just Tell
Provide examples of good vs bad output when the task is subjective.

---

## Common Patterns

| Goal | Pattern |
|------|---------|
| Reasoning | "Let's think step by step" |
| Validation | "What could go wrong with this approach?" |
| Completeness | "What am I missing?" |
| Alternatives | "Give me 3 different approaches with trade-offs" |
| Conciseness | "Answer in one sentence" |
| Structure | "Use headers and bullet points" |

---

## Iteration Checklist
- [x] Did the model answer the actual question?
- [x] Is the output format correct?
- [x] Did it make assumptions I didn't want?
- [x] Is it too long / too short?
- [x] Did it miss edge cases I care about?

## Anti-Patterns
- Vague verbs: "improve", "fix", "handle" â†’ replace with specific actions
- Missing constraints: always say what NOT to do
- No format spec: output format defaults to whatever the model prefers
`,
    },
    {
      id: 'prompt-log',
      name: 'Prompt Iteration Log',
      description: 'Table to track prompt versions, results, and changes',
      icon: 'ðŸ“',
      group: 'prompt-pattern',
      defaultFilename: `prompt-log-${new Date().toISOString().split('T')[0]}.md`,
      content: `# Prompt Iteration Log

**Task / Goal:**
**Model:**
**Date started:** ${new Date().toISOString().split('T')[0]}

---

## Iterations

| # | Prompt Summary | Result Quality | Key Observation | Change Made |
|---|----------------|----------------|-----------------|-------------|
| 1 | [Brief description of prompt v1] | â­â­â­ / 5 | [What worked / didn't work] | [What you changed for v2] |
| 2 | | | | |
| 3 | | | | |

---

## Prompt Versions

### v1
\`\`\`
[Full prompt text]
\`\`\`

**Output sample:**
[Paste a representative output]

**Issues:**
-

---

### v2
\`\`\`
[Full prompt text]
\`\`\`

**Output sample:**
[Paste a representative output]

**Issues:**
-

---

## Final Prompt
\`\`\`
[The winning version]
\`\`\`

**Why it works:**
`,
    },
  ]

  export interface CustomTemplate {
    id: string
    name: string
    description: string
    defaultFilename: string
    content: string
  }

  /**
   * Load custom templates from the user's templates folder.
   * Each .md file in the folder becomes a custom template.
   * Returns [] if folder is empty or not set.
   */
  export async function loadCustomTemplates(
    listFiles: (folder: string) => Promise<Array<{ name: string; path: string }>>,
    readFile: (path: string) => Promise<string>,
    templatesFolder: string,
  ): Promise<CustomTemplate[]> {
    if (!templatesFolder) return []
    try {
      const files = await listFiles(templatesFolder)
      const mdFiles = files.filter((f) => f.name.endsWith('.md'))
      const templates = await Promise.all(
        mdFiles.map(async (f) => {
          const content = await readFile(f.path)
          return {
            id: `custom:${f.name}`,
            name: f.name.replace(/\.md$/, ''),
            description: 'Custom template',
            defaultFilename: f.name,
            content,
          } satisfies CustomTemplate
        }),
      )
      return templates
    } catch {
      return []
    }
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/lib/markdownTemplates.ts`
  - [x] `BUILTIN_TEMPLATES` exports exactly 8 items with correct ids: readme, changelog, todo, roadmap, adr, api-docs, skill-guide, meeting-notes
  - [x] `CLAUDE_TEMPLATES` exports exactly 8 items: 4 with `group: 'system-prompt'` and 4 with `group: 'prompt-pattern'`
  - [x] `loadCustomTemplates` is an async function that returns `CustomTemplate[]`
  - [x] Build passes: `cd frontend && npm run build 2>&1 | tail -20`

- [x] **Step 2: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 3: Commit**

  ```bash
  git add frontend/src/lib/markdownTemplates.ts
  git commit -m "feat: markdown â€” add 8 built-in + 8 Claude AI templates and custom template loader"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows the expected commit message
  - [x] Only `markdownTemplates.ts` in the diff

---

### Task 2: Add markdown.templatesFolder to settings

**Files:**
- Modify: `frontend/src/stores/settings.ts`

- [x] **Step 1: Add `markdown` block to `AppSettings` interface**

  After the `ai` block (or `features` block if P1 was delivered), add:

  ```ts
  markdown: {
    templatesFolder: string
  }
  ```

  **DoD:**
  - [x] `AppSettings` interface has `markdown: { templatesFolder: string }`
  - [x] Build passes

- [x] **Step 2: Add default to `defaultSettings`**

  ```ts
  markdown: {
    templatesFolder: '',
  },
  ```

  **DoD:**
  - [x] `defaultSettings.markdown.templatesFolder` is `''`
  - [x] Build passes

- [x] **Step 3: Add `updateMarkdown` action**

  In `SettingsState` interface:
  ```ts
  updateMarkdown: (patch: Partial<AppSettings['markdown']>) => void
  ```

  In the store implementation:
  ```ts
  updateMarkdown: (patch) => {
    set((s) => ({
      settings: { ...s.settings, markdown: { ...s.settings.markdown, ...patch } },
    }))
    get().save()
  },
  ```

  **DoD:**
  - [x] `updateMarkdown` is in `SettingsState` interface
  - [x] Calling `updateMarkdown({ templatesFolder: '/foo' })` updates the store and calls `save()`
  - [x] Build passes

- [x] **Step 4: Wire migration in `load()`**

  Add to the merge block:
  ```ts
  markdown: mergeBlock(defaultSettings.markdown, parsed.markdown),
  ```

  **DoD:**
  - [x] `markdown: mergeBlock(defaultSettings.markdown, parsed.markdown)` is in `load()`
  - [x] Old settings without `markdown` key gets defaults on load
  - [x] Build passes

- [x] **Step 5: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 6: Commit**

  ```bash
  git add frontend/src/stores/settings.ts
  git commit -m "feat: settings â€” add markdown.templatesFolder field"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows expected message
  - [x] Only `settings.ts` in the diff

---

### Task 3: Create TemplatePickerModal

**Files:**
- Create: `frontend/src/components/markdown/TemplatePickerModal.tsx`

- [x] **Step 1: Create the file**

  ```tsx
  import { useCallback, useEffect, useState } from 'react'
  import { FolderOpen, Loader2, Search, X } from 'lucide-react'
  import {
    BUILTIN_TEMPLATES,
    CLAUDE_TEMPLATES,
    loadCustomTemplates,
    type BuiltinTemplate,
    type ClaudeTemplate,
    type CustomTemplate,
  } from '@/lib/markdownTemplates'
  import { listMarkdownFiles, readMarkdownFile, selectMarkdownFolder } from '@/lib/markdown-api'
  import { useSettingsStore } from '@/stores/settings'
  import { cn } from '@/lib/utils'

  interface TemplatePickerModalProps {
    onSelect: (content: string, filename: string) => void
    onClose: () => void
  }

  type AnyTemplate = (BuiltinTemplate | ClaudeTemplate | CustomTemplate) & { isCustom?: boolean; isClaude?: boolean }

  function TemplateCard({ t, onSelect }: { t: AnyTemplate; onSelect: (content: string, filename: string) => void }) {
    const icon = (t as BuiltinTemplate | ClaudeTemplate).icon ?? 'ðŸ“„'
    return (
      <button
        key={t.id}
        onClick={() => onSelect(t.content, t.defaultFilename)}
        className="flex items-start gap-3 p-3 bg-surface-1 border border-border-2 rounded-lg hover:border-accent hover:bg-surface-2 transition-colors text-left"
      >
        <span className="text-xl leading-none mt-0.5">{icon}</span>
        <div>
          <div className="text-[11px] font-medium text-text-1">{t.name}</div>
          <div className="text-[9px] text-text-4 mt-0.5">{t.description}</div>
        </div>
      </button>
    )
  }

  export function TemplatePickerModal({ onSelect, onClose }: TemplatePickerModalProps) {
    const [query, setQuery] = useState('')
    const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([])
    const [loadingCustom, setLoadingCustom] = useState(false)
    const templatesFolder = useSettingsStore((s) => s.settings.markdown?.templatesFolder ?? '')
    const updateMarkdown = useSettingsStore((s) => s.updateMarkdown)

    // Load custom templates when the modal opens or folder changes
    useEffect(() => {
      if (!templatesFolder) return
      setLoadingCustom(true)
      loadCustomTemplates(
        (folder) => listMarkdownFiles(folder),
        (path) => readMarkdownFile(path),
        templatesFolder,
      )
        .then(setCustomTemplates)
        .finally(() => setLoadingCustom(false))
    }, [templatesFolder])

    const handleSelectFolder = useCallback(async () => {
      const folder = await selectMarkdownFolder()
      if (folder) {
        updateMarkdown({ templatesFolder: folder })
      }
    }, [updateMarkdown])

    const q = query.toLowerCase()
    const matches = (t: { name: string; description: string }) =>
      !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)

    const builtinFiltered = BUILTIN_TEMPLATES.filter(matches)
    const claudeSystemFiltered = CLAUDE_TEMPLATES.filter((t) => t.group === 'system-prompt' && matches(t))
    const claudePatternFiltered = CLAUDE_TEMPLATES.filter((t) => t.group === 'prompt-pattern' && matches(t))
    const customFiltered = customTemplates.filter(matches)

    const hasClaudeSection = claudeSystemFiltered.length > 0 || claudePatternFiltered.length > 0

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        onClick={onClose}
      >
        <div
          className="w-[min(96vw,720px)] h-[min(90vh,640px)] bg-surface-0 border border-border-1 rounded-xl shadow-2xl flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border-1 flex-shrink-0">
            <span className="text-sm font-semibold text-text-1 flex-1">New from Template</span>
            <button
              onClick={onClose}
              className="p-1 rounded text-text-4 hover:text-text-1 hover:bg-surface-2 transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* Search */}
          <div className="px-4 py-2 border-b border-border-1 flex-shrink-0">
            <div className="flex items-center gap-2 bg-surface-2 border border-border-2 rounded px-2">
              <Search size={12} className="text-text-4" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search templatesâ€¦"
                className="flex-1 bg-transparent py-1.5 text-[11px] text-text-1 placeholder-text-4 outline-none"
              />
            </div>
          </div>

          {/* Template grid */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {/* Built-in */}
            {builtinFiltered.length > 0 && (
              <div>
                <div className="text-[9px] text-text-4 uppercase tracking-wide mb-2">Built-in</div>
                <div className="grid grid-cols-2 gap-2">
                  {builtinFiltered.map((t) => <TemplateCard key={t.id} t={t} onSelect={onSelect} />)}
                </div>
              </div>
            )}

            {/* Claude AI */}
            {hasClaudeSection && (
              <div>
                <div className="text-[9px] text-text-4 uppercase tracking-wide mb-2">Claude AI</div>

                {claudeSystemFiltered.length > 0 && (
                  <>
                    <div className="text-[9px] text-text-3 font-medium mb-1.5 pl-0.5">System Prompts &amp; Personas</div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {claudeSystemFiltered.map((t) => <TemplateCard key={t.id} t={t} onSelect={onSelect} />)}
                    </div>
                  </>
                )}

                {claudePatternFiltered.length > 0 && (
                  <>
                    <div className="text-[9px] text-text-3 font-medium mb-1.5 pl-0.5">Prompt Engineering Patterns</div>
                    <div className="grid grid-cols-2 gap-2">
                      {claudePatternFiltered.map((t) => <TemplateCard key={t.id} t={t} onSelect={onSelect} />)}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Custom */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-[9px] text-text-4 uppercase tracking-wide">Custom</div>
                <button
                  onClick={handleSelectFolder}
                  className="flex items-center gap-1 text-[9px] text-accent hover:underline"
                >
                  <FolderOpen size={10} />
                  {templatesFolder ? 'Change folder' : 'Set folderâ€¦'}
                </button>
                {loadingCustom && <Loader2 size={10} className="animate-spin text-text-4" />}
              </div>

              {customFiltered.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {customFiltered.map((t) => <TemplateCard key={t.id} t={{ ...t, isCustom: true }} onSelect={onSelect} />)}
                </div>
              ) : (
                !loadingCustom && (
                  <div className={cn('text-[10px] text-text-4', templatesFolder ? '' : 'italic')}>
                    {templatesFolder
                      ? 'No .md files found in the selected folder.'
                      : 'Select a folder containing .md files to use as custom templates.'}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }
  ```

  **DoD:**
  - [x] File created at `frontend/src/components/markdown/TemplatePickerModal.tsx`
  - [x] Modal renders with backdrop; clicking backdrop calls `onClose`
  - [x] "Built-in" section header and 8 template cards render
  - [x] "Claude AI" section header with two sub-headers: "System Prompts & Personas" and "Prompt Engineering Patterns"
  - [x] "Custom" section with "Set folderâ€¦" button renders
  - [x] Search input filters all three sections simultaneously
  - [x] Clicking a template card calls `onSelect(content, defaultFilename)`
  - [x] Build passes

- [x] **Step 2: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 3: Commit**

  ```bash
  git add frontend/src/components/markdown/TemplatePickerModal.tsx
  git commit -m "feat: markdown â€” add TemplatePickerModal with built-in, Claude AI, and custom template sections"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows expected message
  - [x] Only `TemplatePickerModal.tsx` in the diff

---

### Task 4: Wire the Template button into MarkdownToolbar and MarkdownPanel

**Files:**
- Modify: `frontend/src/components/markdown/MarkdownToolbar.tsx`
- Modify: `frontend/src/components/markdown/MarkdownPanel.tsx`

- [x] **Step 1: Add `onOpenTemplates` prop to `MarkdownToolbarProps`**

  In `MarkdownToolbar.tsx`, find the `MarkdownToolbarProps` interface. Add:

  ```ts
  onOpenTemplates: () => void
  ```

  **DoD:**
  - [x] `onOpenTemplates: () => void` in `MarkdownToolbarProps`
  - [x] Build passes

- [x] **Step 2: Add `onOpenTemplates` to the destructured params**

  In the `MarkdownToolbar` function signature, add `onOpenTemplates` to the destructured props.

  **DoD:**
  - [x] `onOpenTemplates` is destructured in the function signature
  - [x] Build passes

- [x] **Step 3: Add the Template button to the toolbar**

  Add `LayoutTemplate` to the lucide-react import:
  ```ts
  import { Bold, Code, Columns, Eye, FilePlus, FolderOpen, GitBranch, Heading, Image, Italic, LayoutTemplate, Link, Save, Upload } from 'lucide-react'
  ```

  After the "New" button (the `onToggleCreate` button), add:

  ```tsx
  <button
    onClick={onOpenTemplates}
    className="h-7 px-2 flex items-center gap-1.5 text-[11px] text-text-2 hover:text-text-1 rounded hover:bg-surface-2 transition-colors"
    title="New from template"
  >
    <LayoutTemplate size={13} /> Template
  </button>
  ```

  **DoD:**
  - [x] `LayoutTemplate` icon imported
  - [x] "Template" button renders in the toolbar
  - [x] Clicking it calls `onOpenTemplates`
  - [x] Build passes

- [x] **Step 4: Add state and handler in MarkdownPanel**

  In `MarkdownPanel.tsx`, add:

  ```ts
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  ```

  Add a handler for when a template is selected:

  ```ts
  const handleCreateFromTemplate = useCallback(async (content: string, filename: string) => {
    setShowTemplatePicker(false)
    // Create a new file with the template content
    // Use the existing createMarkdownFile API, or write content after creating
    try {
      const path = await createMarkdownFile(filename)
      await writeMarkdownFile(path, content)
      // Refresh the file list and open the new file
      const files = await listMarkdownFiles(markdownRoot)
      setFiles(files)
      const newFile = files.find((f) => f.path === path) ?? files[files.length - 1]
      if (newFile) {
        setActiveFile(newFile)
        setEditorContent(content)
        setDirty(false)
      }
    } catch (err) {
      console.error('Failed to create file from template', err)
    }
  }, [markdownRoot, /* other deps */])
  ```

  Adapt variable names (`markdownRoot`, `setFiles`, `setActiveFile`, `setEditorContent`, `setDirty`) to match whatever the panel currently uses.

  **DoD:**
  - [x] `showTemplatePicker` state defaults to `false`
  - [x] `handleCreateFromTemplate` creates a new file, writes template content, refreshes file list, opens the new file
  - [x] Build passes

- [x] **Step 5: Pass `onOpenTemplates` to `MarkdownToolbar`**

  Find where `<MarkdownToolbar ...>` is rendered. Add:

  ```tsx
  onOpenTemplates={() => setShowTemplatePicker(true)}
  ```

  **DoD:**
  - [x] `<MarkdownToolbar>` receives `onOpenTemplates={() => setShowTemplatePicker(true)}`
  - [x] Build passes

- [x] **Step 6: Render the modal**

  In the `MarkdownPanel` return JSX, add (at the end, before the closing fragment):

  ```tsx
  {showTemplatePicker && (
    <TemplatePickerModal
      onSelect={handleCreateFromTemplate}
      onClose={() => setShowTemplatePicker(false)}
    />
  )}
  ```

  Import at the top:
  ```ts
  import { TemplatePickerModal } from './TemplatePickerModal'
  ```

  **DoD:**
  - [x] `TemplatePickerModal` renders when `showTemplatePicker === true`
  - [x] `TemplatePickerModal` is not rendered when `showTemplatePicker === false`
  - [x] Import at top of `MarkdownPanel.tsx`
  - [x] Build passes

- [x] **Step 7: Build check**

  ```bash
  cd frontend && npm run build 2>&1 | tail -20
  ```

  Expected: no TypeScript errors.

  **DoD:**
  - [x] Exit code 0
  - [x] Zero TypeScript errors in output

- [x] **Step 8: Manual smoke test**

  Run `wails dev`. Go to Markdown. Verify:
  - A "Template" button appears in the toolbar between "New" and "Save".
  - Clicking it opens the template picker modal.
  - Clicking a built-in template (e.g., README) creates a new file pre-filled with the template content.
  - The file gets the correct default filename (e.g., `README.md`).
  - "Set folderâ€¦" button opens a folder picker. After selecting, `.md` files from that folder appear in the Custom section.
  - Search filters both built-in and custom templates.
  - Pressing Escape or clicking the backdrop closes the modal.

  **DoD:**
  - [x] "Template" button visible in toolbar
  - [x] Clicking button opens the picker modal
  - [x] Clicking a Built-in template (e.g. README) creates new file with template content and filename `README.md`
  - [x] "Claude AI" section shows two sub-groups with correct templates
  - [x] "Set folderâ€¦" opens a folder picker; .md files from selected folder appear as custom templates
  - [x] Search filters all three sections
  - [x] Pressing Escape or clicking backdrop closes modal

- [x] **Step 9: Commit**

  ```bash
  git add frontend/src/components/markdown/MarkdownToolbar.tsx frontend/src/components/markdown/MarkdownPanel.tsx
  git commit -m "feat: markdown â€” Template button in toolbar opens template picker"
  ```

  **DoD:**
  - [x] `git log --oneline -1` shows expected message
  - [x] `MarkdownToolbar.tsx` and `MarkdownPanel.tsx` in the diff
