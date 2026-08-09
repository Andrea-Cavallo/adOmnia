# Contributing to adOmnia

Thanks for considering a contribution. adOmnia is a production-grade local-first desktop developer toolbox, so contributions should improve the real product experience: clearer workflows, stronger integrations, better UI cohesion, safer local behavior, or more reliable packaging.

## Before You Start

Read:

- [README.md](README.md) for product positioning and build overview.
- [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) for architecture and local conventions.
- [docs/SOUL.md](docs/SOUL.md) for product philosophy.
- [docs/funzionalita.md](docs/funzionalita.md) for the feature catalog.
- [docs/TODO.md](docs/TODO.md) for active gaps.

## Development Setup

Requires Go 1.26.5+, Node.js 20+, and the Wails 3 CLI.

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.5

cd frontend
npm install
cd ..

wails3 task dev
```

Common checks:

```bash
cd frontend
npm run build
cd ..
go test ./...
```

## Contribution Guidelines

- Keep changes focused and product-oriented.
- Prefer small, local edits over broad refactors.
- Preserve local-first behavior: no telemetry, no hidden sync, no external calls without explicit user action.
- For UI changes, keep the dense professional developer-tool aesthetic.
- For storage/workspace changes, preserve backward compatibility and document migrations.
- For security-sensitive changes, update [.github/SECURITY.md](.github/SECURITY.md) or [PRIVACY.md](PRIVACY.md) when behavior changes.

## Pull Requests

Use the pull request template and include:

- What changed and why.
- Screenshots or short recordings for UI changes.
- Manual test notes for user-facing workflows.
- `npm run build` and/or `go test ./...` results when relevant.
- Any release-note-worthy change under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).

## Commit Style

Use clear, boring commit messages:

- `feat: add linux artifact export`
- `fix: run post-response scripts after request`
- `docs: document release artifact downloads`
- `chore: update workflow triggers`

## Security Reports

Do not open public issues for vulnerabilities. Follow [.github/SECURITY.md](.github/SECURITY.md).
