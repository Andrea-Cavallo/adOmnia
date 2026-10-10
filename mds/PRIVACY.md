# Privacy Policy

adOmnia is designed as a local-first desktop application.

## Short Version

- No account is required.
- No telemetry is collected.
- No cloud sync is built in.
- Workspaces, collections, settings, logs, captures, vaults, and templates stay on your machine unless you explicitly export or send them.

## Data Stored Locally

Depending on the features you use, adOmnia may store:

- API collections, requests, headers, bodies, scripts, and assertions.
- Environment variables and workspace settings.
- Response history and local logs.
- Mock server configuration and hit logs.
- Proxy and HAR capture data.
- Browser debugging metadata captured during explicit debug sessions.
- Database connection profiles.
- Vault entries encrypted locally.
- Themes, templates, plugins, and UI settings.
- Go Studio sessions, run configurations, local file history and crash-recovery buffers.
- Received OpenTelemetry traces and saved reproductions (`repro/…`) when you use them.
- A local Live Collaboration audit log (who joined, invites, role changes) without tokens or shared values.

Storage may use local files, bbolt, localStorage, or exported `.adomnia` workspace files.

## Network Activity

adOmnia only makes network requests as part of user-triggered workflows, such as:

- Sending API requests.
- Connecting to brokers, databases, WebSocket/SSE endpoints, or gRPC services.
- Running proxy/mock/browser debugging sessions.
- Pulling local Docker Lab resources when explicitly used.
- **Check for updates**: only when you ask, adOmnia queries the GitHub Releases API for the latest version.
- **AI features**: prompts and the context you choose go to the AI provider you configured, only when you send them. In environment-credential mode the API key is read from the process environment and never stored or shown.
- **GitHub Copilot**: the language server is downloaded from the npm registry only on your action and talks to the GitHub host of your profile (github.com, GHE.com or GHES). Files excluded by `.adomnia/aiignore` or the secret filter are never sent.
- **Live Collaboration**: peer-to-peer over your LAN with TLS and certificate pinning, only after you host or join a session; nothing goes through a cloud relay.
- **Go Studio tooling**: `go`, `gopls`, Delve and linters may download modules or tools when you build, run or install them; *Vulnerabilities* (govulncheck) queries vuln.go.dev only when you start a scan and is blocked in offline mode.
- **Local listeners**: the mock server, proxy and OpenTelemetry receiver listen on your machine (the OTLP receiver on 127.0.0.1) only while you start them.

The application does not send product analytics or hidden telemetry.

## Secrets

The Vault is intended for sensitive values. Collections and ordinary environment data outside the Vault may be stored unencrypted, depending on the module and workspace format. Do not store production secrets in plain request fields unless you understand the local storage implications.

## Exports

Exported workspaces, HAR files, logs, and reports can contain sensitive data such as tokens, headers, URLs, payloads, cookies, certificates, or internal hostnames. Review exports before sharing them.

## Third-Party Services

adOmnia does not require a third-party account. If you connect to external APIs, databases, brokers, or services, those services process the data you send to them according to their own policies.

## Changes

Privacy-relevant behavior changes should be documented in this file and in [CHANGELOG.md](../CHANGELOG.md).
