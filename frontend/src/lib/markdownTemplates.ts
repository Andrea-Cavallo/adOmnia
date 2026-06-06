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
    icon: '📦',
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
    icon: '📋',
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

## [1.0.0] — ${new Date().toISOString().split('T')[0]}

### Added
- Initial release
`,
  },
  {
    id: 'todo',
    name: 'TODO',
    description: 'Task list with priority categories',
    icon: '✅',
    defaultFilename: 'TODO.md',
    content: `# TODO

## 🔴 High Priority

- [ ] Task one
- [ ] Task two

## 🟡 Medium Priority

- [ ] Task three
- [ ] Task four

## 🟢 Low Priority

- [ ] Task five

## ✅ Done

- [x] Completed task
`,
  },
  {
    id: 'roadmap',
    name: 'Roadmap',
    description: 'Phase-based roadmap with checkboxes and milestones',
    icon: '🗺️',
    defaultFilename: 'ROADMAP.md',
    content: `# Roadmap

## Phase 1 — Foundation

- [ ] Core feature A
- [ ] Core feature B
- [ ] Core feature C

## Phase 2 — Growth

- [ ] Feature D
- [ ] Feature E

## Phase 3 — Polish

- [ ] Performance improvements
- [ ] Documentation
- [ ] Accessibility

## Non-Goals

- Thing we are explicitly not doing
`,
  },
  {
    id: 'adr',
    name: 'Technical Note (ADR)',
    description: 'Architecture Decision Record format for technical decisions',
    icon: '🏗️',
    defaultFilename: 'untitled-adr.md',
    content: `# ADR — [Decision Title]

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
    icon: '🔌',
    defaultFilename: 'untitled-api-docs.md',
    content: `# API Documentation — [Service Name]

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
    icon: '📖',
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
    icon: '🗒️',
    defaultFilename: `meeting-${new Date().toISOString().split('T')[0]}.md`,
    content: `# Meeting Notes — ${new Date().toISOString().split('T')[0]}

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
  // ── System Prompts & Personas ──────────────────────────────────────────────
  {
    id: 'claude-coder',
    name: 'System Prompt — Coder',
    description: 'Assistant prompt for coding tasks: rules, style, output format',
    icon: '🤖',
    group: 'system-prompt',
    defaultFilename: 'system-prompt-coder.md',
    content: `# System Prompt — Coding Assistant

## Role
You are an expert software engineer. You write clean, idiomatic, production-ready code.

## Rules
- Always use the language/framework already present in the codebase
- Prefer editing existing files over creating new ones
- Never add comments that describe what the code does — only add comments for non-obvious WHY
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
    name: 'System Prompt — Reviewer',
    description: 'Structured code review with severity levels',
    icon: '🔍',
    group: 'system-prompt',
    defaultFilename: 'system-prompt-reviewer.md',
    content: `# System Prompt — Code Reviewer

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
- [ ] No hardcoded secrets or credentials
- [ ] No SQL injection (parameterized queries used)
- [ ] No XSS (user input sanitized)
- [ ] Errors handled explicitly, not swallowed
- [ ] No functions longer than 50 lines
- [ ] No files longer than 800 lines
- [ ] New functionality has tests

## Output Format
For each finding:
\`\`\`
[SEVERITY] file.ts:line — Description of issue
Suggestion: how to fix it
\`\`\`

End with a summary: APPROVE / APPROVE WITH COMMENTS / BLOCK.
`,
  },
  {
    id: 'claude-analyst',
    name: 'System Prompt — Analyst',
    description: 'Research, data analysis, synthesis and reporting',
    icon: '📊',
    group: 'system-prompt',
    defaultFilename: 'system-prompt-analyst.md',
    content: `# System Prompt — Research & Analysis Assistant

## Role
You are a research analyst. You gather information, synthesize findings, and present clear, actionable insights.

## Process
1. Restate the question to confirm understanding
2. Identify what information is needed
3. Gather and evaluate sources
4. Synthesize findings — highlight agreements and contradictions
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
    icon: '🎭',
    group: 'system-prompt',
    defaultFilename: 'ai-persona.md',
    content: `# AI Persona — [Name]

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

  // ── Prompt Engineering Patterns ────────────────────────────────────────────
  {
    id: 'chain-of-thought',
    name: 'Chain-of-Thought',
    description: 'Step-by-step reasoning template with confidence scoring',
    icon: '🧠',
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
1. Step 1: Identify the data path (client → API → database / cache)
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
    description: 'Input→output template with 3 annotated examples',
    icon: '🎯',
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
[Brief annotation — helps the model understand the pattern]

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
    icon: '📋',
    group: 'prompt-pattern',
    defaultFilename: 'prompt-best-practices.md',
    content: `# Prompt Engineering — Best Practices Reference

## Core Principles

### 1. Be Specific
❌ "Write a function to process data"
✅ "Write a TypeScript function that takes an array of User objects and returns a new array with only users where isActive is true, sorted by lastName ascending"

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
- [ ] Did the model answer the actual question?
- [ ] Is the output format correct?
- [ ] Did it make assumptions I didn't want?
- [ ] Is it too long / too short?
- [ ] Did it miss edge cases I care about?

## Anti-Patterns
- Vague verbs: "improve", "fix", "handle" → replace with specific actions
- Missing constraints: always say what NOT to do
- No format spec: output format defaults to whatever the model prefers
`,
  },
  {
    id: 'prompt-log',
    name: 'Prompt Iteration Log',
    description: 'Table to track prompt versions, results, and changes',
    icon: '📝',
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
| 1 | [Brief description of prompt v1] | ⭐⭐⭐ / 5 | [What worked / didn't work] | [What you changed for v2] |
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
