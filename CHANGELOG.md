# Changelog

All notable changes to adOmnia are documented here.

This project follows a pragmatic release log format inspired by Keep a Changelog. Versions are created from Git tags such as `v0.1.0`; GitHub Actions builds the Windows, Linux, and macOS artifacts automatically.

## [Unreleased]

### Added
- GitHub Actions desktop artifact pipeline for Windows, Linux, and macOS.
- Layered hub layout for the main desktop workspace.
- Runtime support for request scripts and test/post-response execution.

### Changed
- README download instructions now point users to GitHub Releases and Actions artifacts.

### Fixed
- Linux Docker artifact export no longer creates a container from a scratch image.

## [0.1.0] - unreleased

Initial public packaging target.

### Included
- Wails 2 desktop shell with Go backend and React/TypeScript frontend.
- API workspace, environments, scripts, assertions, response viewer, and import tooling.
- SOAP, gRPC, WebSocket/SSE, brokers, mock server, proxy, browser debugging, database tools, vault, and utilities.
