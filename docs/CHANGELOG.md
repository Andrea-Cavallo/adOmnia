# Changelog

All notable changes to adOmnia will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Professional Settings Panel** — centralised application settings accessible from the top-right gear icon.
  - 9 sections: General, Appearance, Request Defaults, Proxy/Interceptor, Mock Server, Storage & Workspace, Security, Advanced, About.
  - Versioned persistence (`adomnia.settings`, schema v1) with backward-compatible defaults.
  - Real-time localStorage usage estimates and diagnostic export.
  - Per-section reset-to-defaults in Advanced settings.
- **Security settings integration** — script execution confirmation, auto token refresh disable, secret masking toggle.
- **Global settings wiring** — proxy and mock panels now read defaults from global settings.
- **DevMode** now initialised from settings (Advanced section).

### Changed
- ProxyUI and MockUI now use global settings as defaults, fall back to session-local overrides.

### Planned
- Flows rewrite (Excalidraw-style visual editor)
- Environment sync from diff view
- Response schema diff (notify on changes)
- Share single request via clipboard

---

## [1.0.0] - 2024-01-15

### 🎉 Initial Release

#### Added
- **Native desktop application** with embedded WebView2 (Windows) / WebKit (macOS/Linux)
- **HTTP methods**: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS
- **WebSocket client** with live message streaming
- **Request composer** with multi-tab interface
- **Postman v2.1 collection import** (drag-and-drop or paste JSON)
- **Environment variables** with `{{varName}}` substitution
- **Authentication methods**:
  - Bearer token
  - Basic auth
  - API key (header/query param)
- **Request body formats**:
  - Raw text
  - JSON with syntax highlighting
  - URL-encoded form data
  - Multipart form-data
- **Response viewer**:
  - Pretty-print JSON with collapsible trees
  - Raw text view
  - Response headers display
  - Status code and time tracking
- **Request history** (last 50 requests auto-saved)
- **Collection management**:
  - Create folders and organize requests
  - Search through collections
  - Context menu for quick actions
- **Keyboard shortcuts**:
  - `Ctrl+Enter` - Send request
  - `Ctrl+N` - New tab
  - `Ctrl+S` - Save to collection
  - `Ctrl+W` - Close tab
- **Built-in CORS proxy** at `/proxy?url=<target>`
- **localStorage persistence** - all data saved locally
- **Health check endpoint** at `/health`
- **Auto-port selection** (17878-17900 range, fallback to random)
- **Cross-platform builds**:
  - Windows (amd64, 386)
  - macOS (amd64, arm64)
  - Linux (amd64, arm64)

#### Technical Details
- Go 1.22+ backend with embedded static files (`go:embed`)
- React 18 frontend with in-browser JSX transpilation (Babel)
- Zero build step for frontend development
- Single binary distribution (~5MB)
- No external dependencies at runtime (except WebView2 on Windows)

---

## Release Notes

### Version Numbering
- **Major version** (X.0.0): Breaking changes, major UI overhauls
- **Minor version** (1.X.0): New features, backwards-compatible
- **Patch version** (1.0.X): Bug fixes, minor improvements

### Upgrade Instructions
Simply download the new binary and replace the old one. All data is preserved in your system's app data folder.

### Support Policy
- Latest major version: Full support with new features and bug fixes
- Previous major version: Critical bug fixes only for 6 months
- Older versions: Community support only

---

## [0.9.0] - 2023-12-01 (Beta)

### Added
- Initial beta release for testing
- Core HTTP request functionality
- Basic UI with single-tab interface
- JSON response viewer
- localStorage-based persistence

### Known Issues
- No WebSocket support yet
- No environment variables
- Limited keyboard shortcuts

---

[Unreleased]: https://github.com/yourusername/adomnia/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/yourusername/adomnia/releases/tag/v1.0.0
[0.9.0]: https://github.com/yourusername/adomnia/releases/tag/v0.9.0
