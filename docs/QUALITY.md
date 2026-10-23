# Code quality toolchain

How adOmnia's own Go/TypeScript code is analyzed: lint, SAST, secrets, dependencies and Sonar.
Everything runs locally first — the CI workflows only repeat the same commands.

## The tools

| Tool | What it covers | Where |
| --- | --- | --- |
| [golangci-lint](https://golangci-lint.run/) v2 | Go lint: govet, errcheck, staticcheck, ineffassign, unused + gocyclo, nakedret, whitespace, copyloopvar, durationcheck; gofmt | `.golangci.yml`, CI `quality.yml` |
| [gosec](https://github.com/securego/gosec) | Go security rules (crypto, file permissions, subprocess) | CI `quality.yml` (`-severity=HIGH`) |
| [govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck) | Reachable vulnerabilities in dependencies **and the Go standard library** | CI `quality.yml` |
| [oxlint](https://oxc.rs/docs/guide/usage/linter) | Frontend lint (TS native): correctness, React Hooks, React Compiler rules | `frontend/.oxlintrc.json`, CI `quality.yml` |
| [SonarQube](https://www.sonarqube.org/) / [SonarCloud](https://sonarcloud.io) | Issues, smells, duplications, coverage across Go and TS | `sonar-project.properties`, CI `sonar.yml` |
| [CodeQL](https://codeql.github.com/) | Semantic security analysis (Go, TS), results in the Security tab | CI `codeql.yml` |
| [gitleaks](https://github.com/gitleaks/gitleaks) | Secrets in the working tree and in git history | CI `quality.yml` |
| [Trivy](https://trivy.dev/) | Vulnerable dependencies, leaked secrets, misconfigurations | CI `quality.yml` (report-only) |
| [Semgrep](https://semgrep.dev/) | SAST rules (`p/security-audit`, `p/secure-defaults`) | CI `quality.yml` (report-only) |
| `npm audit` | Frontend dependency advisories (fails on high/critical) | CI `quality.yml` |
| [ShellCheck](https://www.shellcheck.net/), [hadolint](https://github.com/hadolint/hadolint), [actionlint](https://github.com/rhysd/actionlint) | Install/build scripts, Dockerfiles, GitHub workflows | CI `quality.yml` |
| [dependency-review](https://github.com/actions/dependency-review-action), [OSSF Scorecard](https://securityscorecards.dev/) | Dependency changes in PRs, repository security posture | CI `supply-chain.yml` |
| `go test`, `npm test` + coverage | Tests, `coverage.out` / `lcov.info` for Sonar | existing `build.yml` |

## Local commands

```bash
golangci-lint run --timeout 8m        # Go lint (.golangci.yml)
gosec -severity=HIGH ./...            # Go security rules (full run drops -severity)
govulncheck ./...                     # reachable vulnerabilities
go vet ./internal/...                 # quick sanity check
cd frontend && npm test               # frontend tests
cd frontend && npm run lint           # oxlint
cd frontend && npm audit              # dependency advisories
```

Install with `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v2.15.0`,
`go install github.com/securego/gosec/v2/cmd/gosec@latest` and
`go install golang.org/x/vuln/cmd/govulncheck@latest`. Make sure the `GOBIN`/`GOPATH` bin directory
on your `PATH` is the current one: a stale `govulncheck` built with an older Go fails with
`package requires newer Go version` on every package instead of scanning.

Script, Dockerfile and workflow lints run in Docker (or the CI images):

```bash
docker run --rm -v "$PWD:/repo" -w /repo koalaman/shellcheck:stable build.sh build/*.sh build/linux/*.sh scripts/*.sh packaging/render.sh
docker run --rm -v "$PWD:/repo" -w /repo hadolint/hadolint:latest hadolint Dockerfile.linux build/Dockerfile docker/adomnia-lab/mock-api/Dockerfile
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest
```

## SonarQube locally (Docker)

```bash
docker run -d --name adomnia-sonar -p 9000:9000 sonarqube:community
# wait for http://localhost:9000 to say UP, then create a token (admin/admin works only with Basic auth):
curl -u admin:admin -X POST "http://localhost:9000/api/users/change_password" \
  -d "login=admin&previousPassword=admin&password=<new-password>"
curl -u admin:<new-password> -X POST "http://localhost:9000/api/user_tokens/generate" -d "name=adomnia-cli"
sonar-scanner -Dsonar.host.url=http://localhost:9000 -Dsonar.token=<token>
```

The analysis profile lives in `sonar-project.properties` (sources, exclusions for generated code and
testdata, test inclusions, coverage report paths). Coverage is optional; to feed it:

```bash
go test ./internal/... ./cmd/... -coverprofile=coverage.out -covermode=atomic
cd frontend && npx vitest run --coverage --coverage.reporter=lcov
```

### Where coverage stands (Go)

The `Checks` job of `build.yml` writes `coverage.out` during its normal `go test` run (no second test pass) and
`scripts/coverage-summary.sh` turns it into the job summary: the total for `internal/` and `cmd/` plus a table per
package, lowest first. The profile is also kept as the `go-coverage` artifact for 30 days. Locally:

```bash
go test ./internal/... ./cmd/... -coverprofile=coverage.out -covermode=atomic
scripts/coverage-summary.sh coverage.out
```

The root Wails package is excluded (it embeds `frontend/dist` and needs GTK). The script only reports: it does not
fail the build, because the 80% line is an awesome-go guideline for non-data packages "where applicable", not a gate
for a desktop app. Publishing the number to Codecov or Coveralls is a separate step (`mds/todos-adomnia.md`, AW-5).

## SonarCloud (CI)

The `sonar` job in `sonar.yml` (its own workflow, so `quality.yml` stays green without a Sonar token) scans
with SonarCloud when the repository is configured, and skips the job otherwise:

1. Create the project on [sonarcloud.io](https://sonarcloud.io) (GitHub App or manual import).
2. Add the **secret** `SONAR_TOKEN` (SonarCloud → My Account → Security → Generate Token). The job stops with a
   clear message if it is missing.
3. Add the repository **variables** (not secrets: the workflow reads `vars.*`) `SONAR_PROJECT_KEY`
   (`Andrea-Cavallo_adOmnia`) and `SONAR_ORGANIZATION` (`andrea-cavallo`).

`sonar-project.properties` is shared with the local runs; the workflow passes `sonar.projectKey`,
`sonar.organization` and `sonar.host.url` on the command line.

## Deliberate choices (read before "fixing" the config)

- **`misspell` is banned from golangci-lint**: it rewrites Italian words as broken English
  (`impossibile` → `impossible`) in comments and messages. Do not re-enable it.
- **`typescript-eslint` is not usable**: the project is on TypeScript 7 and the package supports
  `<6.1` only. oxlint lints TS natively without the compiler API; the rules that would need the type
  checker stay out until typescript-eslint catches up.
- **oxlint severity**: `error` = real bugs (the gate), `warn` = the React Compiler migration
  (`purity`, `immutability`, `memo-dependencies`, `set-state-in-effect`…) and style. Tighten the
  rules as the migration progresses.
- **gosec categories**: a full run also reports G306 (file permissions `0600`), G505 (`sha1` used for
  fingerprints), G103 (Win32 `unsafe` interop) and G104 (unchecked errors): those are design choices
  here, the CI gate is `-severity=HIGH -confidence=HIGH`.
- **Semgrep and Trivy are report-only** in CI until their findings are triaged (`// nosemgrep`
  annotations for the intentional ones). They must not be made blocking before that.
- Coverage excludes the Wails root package (`frontend/dist` embed and GTK tags): the CI quality job
  covers `./internal/...` and `./cmd/...`.
- `frontend/bindings/`, `*.generated.*`, `testdata/` and `*.pb.go` are excluded everywhere: generated
  code is not a finding.
- `*.sh` is forced to LF in `.gitattributes`: a CRLF script breaks on Linux (shellcheck SC1017).
- SonarCloud free tier requires a public repository or an OSS organization.

## Work queue (Sonar baseline: 152 bugs, 44 vulnerabilities)

| Item | Status |
| --- | --- |
| S2819 `postMessage` without origin check (`CodeStudioPreviewFrame`, `live.js`, `DevLogOverlay` listeners) | done: listeners verify `event.source` and `event.origin`; the remaining `'*'` targets now use `window.location.origin` and the `CodeStudioPreviewFrame` check is unconditional |
| S2871 `.sort()` without comparator (~45 in `frontend/src`) | done: `localeCompare`; AWS4 signed headers keep a code-point comparator (byte order is part of the signature) |
| Security hotspots and taint findings (150 issues: workflows script-injection, Zip Slip false positives, SQL console, network-tool SSRF, temp files, weak-hash fingerprints, ReDoS, PRNG ids) | done 2026-10-23: real fixes where real (env-indirection in workflows, `crypto.getRandomValues` ids and password generation, linear ReDoS rewrite, `os.CreateTemp`/`MkdirTemp`, `rundll32` instead of `cmd /c start`, `%q` log escaping, `USER node`, action SHA pins); by-design behaviour carries `// NOSONAR` with the justification inline |
| Reliability High (63: bash `[[`, `.map(callback)`, `then` on an object, `Math.trunc`) | done 2026-10-23 (bash and `.map()` in the parallel session, the rest here) |
| `process_windows.go`/`process_unix.go` duplicated in `copilot` and `milk` | done 2026-10-23: consolidated into `internal/procutil` (`ConfigureChild`/`KillTree`), the four copies deleted |
| Duplicated lines 2.1% — `i18n.ts` (5 locales × same key tree), `settings.ja/ru/zh.ts`, `builtinThemeFallbacks.ts`, `consoleTemplates.ts`, `themes.go`, `demoWorkspace.ts` | accepted: these are parallel **data** dictionaries (locale catalogs, per-dialect SQL templates, theme/demo fixtures); consolidating them means a translation/template architecture refactor with UI regression risk and no behaviour gain. The one real refactor worth doing is folding `i18n.ts` `BASE` into the `lazyTranslations` per-locale files — tracked here, not urgent |
| Duplicated test scaffolding (`AISettings.test.ts`, `MockPanel.test.ts`, `KVEditor.tsx`) | open (low value): extract shared test helpers only when those files are next touched |
| 18 functions over the complexity threshold (`runMongoQuery` at 85) | open |
| 14 `errcheck` findings | open |
| 12 Hadolint warnings on Dockerfiles | open (the executable-download ones are annotated; the rest are style) |
| React Compiler migration (oxlint `warn` rules) | open |
| ~10 info warnings in `release.yml` | open |
| Semgrep/Trivy triage (`// nosemgrep`), then make them blocking | open |
| Trivy runs in CI only (the Windows mount is unstable locally) | by design |
