# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x.x   | ✅        |
| < 1.0   | ❌        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Send a private report to: **a.cavallo@outlook.it**

Include:
- Type of vulnerability
- Full description and steps to reproduce
- Potential impact
- Suggested fix (if any)

**Response timeline:**
- Initial response: within 48 hours
- Status update: within 7 days
- Fix: Critical within 7 days, High within 30 days, Medium within 90 days

## Security Architecture

adOmnia is local-first by design:

- No cloud sync, no telemetry, no external network calls without user action
- Secrets stored in bbolt via `age` X25519 encryption (Vault module)
- HTTP server bound to `localhost` only, random port
- WebView2/WebKit sandbox — no elevated privileges required
- Proxy and mock servers start only on explicit user action

**Known limitations:**
- Collections and environments outside the Vault are stored unencrypted in bbolt — do not store raw credentials there
- WebView2/WebKit security depends on the host system being up to date
- The CORS proxy forwards requests — use only with trusted target URLs

## Disclosure Policy

Coordinated disclosure: private report → fix → release → public details 30 days after release.
