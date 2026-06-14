# Changelog

All notable changes to adOmnia are documented here.

This project follows a pragmatic release log format inspired by Keep a Changelog. Versions are created from Git tags such as `v0.1.0`; GitHub Actions builds the Windows, Linux, and macOS artifacts automatically.

## [Unreleased]

## [0.2.2] - 2026-06-14

### Added
- **PDF Editor** panel: view, annotate (free text, highlight, shapes, ink), fill
  AcroForm fields, place a visible signature, and export a flattened PDF. Projects
  are re-editable and persisted locally (bbolt). Open via drag-drop, file picker, or
  the "Open in PDF Editor" action on `application/pdf` API responses.
- **Cryptographic PDF signing** with `digitorus/pdfsign` (real ByteRange/CMS
  signatures), including signature verification from the toolbar.
- **Enterprise signing tier:**
  - Import **PKCS#12 (`.p12`/`.pfx`) and JKS** keystores directly in the signing
    dialog (pure-Go, no `keytool`/`openssl`); the private key is extracted in the
    backend and never reaches the frontend.
  - **Inspect certificate** before signing — shows subject, issuer, validity, and
    chain length without exposing the private key.
  - **RFC 3161 timestamping** via a configurable TSA URL (optional basic auth; URL
    can be remembered, credentials never stored).
  - **Long-term validation (LTV)** — embeds the certificate chain plus OCSP/CRL
    revocation data into the document DSS.
- Read-only **API Docs / Swagger viewer** (OpenAPI 3 and Swagger 2.0).
- GitHub Actions desktop artifact pipeline for Windows, Linux, and macOS.
- Layered hub layout for the main desktop workspace.
- Runtime support for request scripts and test/post-response execution.

### Changed
- Improved Markdown layout and Git diff workflow.
- README download instructions now point users to GitHub Releases and Actions artifacts.

### Fixed
- OpenAPI import now also accepts PDF-sourced specs.
- Linux Docker artifact export no longer creates a container from a scratch image.

### Out of scope
- PKCS#11 / HSM / smart-card signing (requires native OS drivers; conflicts with the
  single portable executable) and PAdES B-LTA archive-timestamp refresh.

## [0.1.0] - unreleased

Initial public packaging target.

### Included
- Wails 2 desktop shell with Go backend and React/TypeScript frontend.
- API workspace, environments, scripts, assertions, response viewer, and import tooling.
- SOAP, gRPC, WebSocket/SSE, brokers, mock server, proxy, browser debugging, database tools, vault, and utilities.
