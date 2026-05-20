# Building adOmnia from Source

This guide covers building adOmnia for all supported platforms: Windows, macOS, and Linux.

**Stack:** React 18 + TypeScript + Vite (frontend) + Wails 2 + Go (backend)

---

## Build Matrix

| Host → Target | Windows | macOS Intel | macOS ARM | Linux AMD64 | Linux ARM64 |
|---------------|---------|-------------|-----------|-------------|-------------|
| **Windows** | ✅ native | ❌ not supported | ❌ not supported | ❌ not supported | ❌ not supported |
| **macOS** | ❌ not supported | ✅ native | ✅ native | ✅ Docker | ❌ not supported |
| **Linux** | ❌ not supported | ❌ not supported | ❌ not supported | ✅ native | ✅ native |

**Legend:** ✅ = fully supported and tested, ❌ = not supported by Wails

> **Note:** Wails does not support cross-compilation between different OS families. Build on the target platform or use CI/CD (GitHub Actions).

---

## Prerequisites

### All Platforms
- **Node.js 18+** ([Download](https://nodejs.org/))
- **Go 1.21+** ([Download](https://go.dev/dl/))
- **Wails 2** — `go install github.com/wailsapp/wails/v2/cmd/wails@latest`
- **Git** ([Download](https://git-scm.com/downloads))

### Platform-Specific Requirements

#### Windows
- **Microsoft C++ Build Tools**
  - Install via [Visual Studio Build Tools](https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022)
  - Select "Desktop development with C++"
- **WebView2** (pre-installed on Windows 11)
  - Download: https://developer.microsoft.com/microsoft-edge/webview2/

#### macOS
- **Xcode Command Line Tools**
  ```bash
  xcode-select --install
  ```
- **WebKit framework** (included in macOS)

#### Linux
- **System dependencies:**
  ```bash
  # Debian/Ubuntu
  sudo apt-get update
  sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev \
    libayatana-appindicator3-dev librsvg2-dev

  # Fedora/RHEL
  sudo dnf install gtk3-devel webkit2gtk4.0-devel \
    libayatana-appindicator-gtk3-devel librsvg2-devel

  # Arch
  sudo pacman -S gtk3 webkit2gtk libayatana-appindicator librsvg
  ```

---

## Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/adomnia.git
cd adomnia

# Install Node.js dependencies (frontend)
cd frontend && npm install && cd ..

# Start dev server with hot reload
wails dev

# Build production binary (stripped, no debug info)
wails build -ldflags "-s -w" -trimpath
```

### One-command build scripts (include ldflags automatically)

```bash
# macOS / Linux
./build.sh

# Windows (PowerShell)
.\build.ps1
```

---

## Development

### Dev Server (Hot Reload)

```bash
# Start dev server
npm run tauri dev
```

This starts:
1. Vite dev server (frontend) on `http://localhost:5173`
2. Tauri window that loads the dev server
3. Hot reload for both frontend and Rust changes

### Project Structure

```
adomnia/
├── src/                  # React frontend (TypeScript)
├── src-tauri/            # Tauri backend (Rust)
│   ├── src/
│   │   ├── main.rs       # Tauri entry point
│   │   ├── commands/     # Backend commands (IPC)
│   │   └── lib.rs        # Command registration
│   ├── tauri.conf.json   # Tauri configuration
│   └── Cargo.toml        # Rust dependencies
├── public/               # Static assets
├── package.json          # Node.js dependencies
└── vite.config.ts        # Vite configuration
```

---

## Production Builds

### Windows

```bash
# Build release binary
npm run tauri build
```

**Output:**
- `src-tauri/target/release/adomnia.exe` — Portable executable
- `src-tauri/target/release/bundle/msi/adOmnia_1.0.0_x64_en-US.msi` — Installer

**Build without console window:**

Already configured in `tauri.conf.json`:
```json
{
  "tauri": {
    "windows": [{
      "title": "adOmnia",
      "decorations": true,
      "transparent": false
    }]
  }
}
```

**Compress binary (optional):**
```bash
# Requires UPX installed
upx --best --lzma src-tauri/target/release/adomnia.exe
```

---

### macOS

```bash
# Build for current architecture (Intel or Apple Silicon)
npm run tauri build
```

**Output:**
- `src-tauri/target/release/adOmnia.app` — App bundle
- `src-tauri/target/release/bundle/dmg/adOmnia_1.0.0_x64.dmg` — DMG installer (Intel)
- `src-tauri/target/release/bundle/dmg/adOmnia_1.0.0_aarch64.dmg` — DMG installer (Apple Silicon)

**Build universal binary (Intel + Apple Silicon):**

```bash
# Install Rust targets
rustup target add x86_64-apple-darwin
rustup target add aarch64-apple-darwin

# Build for both architectures
npm run tauri build -- --target universal-apple-darwin
```

**Code signing (required for distribution):**

1. Get Apple Developer ID certificate
2. Configure in `tauri.conf.json`:
```json
{
  "tauri": {
    "bundle": {
      "macOS": {
        "signingIdentity": "Developer ID Application: Your Name (TEAM_ID)",
        "providerShortName": "TEAM_ID",
        "entitlements": null
      }
    }
  }
}
```

3. Build:
```bash
npm run tauri build
```

---

### Linux

```bash
# Build release binary
npm run tauri build
```

**Output:**
- `src-tauri/target/release/adomnia` — Portable binary
- `src-tauri/target/release/bundle/deb/adomnia_1.0.0_amd64.deb` — Debian package
- `src-tauri/target/release/bundle/appimage/adomnia_1.0.0_amd64.AppImage` — AppImage

**Supported package formats:**

Configure in `tauri.conf.json`:
```json
{
  "tauri": {
    "bundle": {
      "targets": ["deb", "appimage", "rpm"]
    }
  }
}
```

Available targets: `deb`, `appimage`, `rpm`

---

## Configuration

### Version Management

Edit `src-tauri/tauri.conf.json`:

```json
{
  "package": {
    "productName": "adOmnia",
    "version": "1.0.0"
  }
}
```

Also update `src-tauri/Cargo.toml`:

```toml
[package]
name = "adomnia"
version = "1.0.0"
```

### App Icon

Replace icons in `src-tauri/icons/`:
- `icon.png` — 1024x1024 PNG (source)
- `icon.ico` — Windows icon (generated)
- `icon.icns` — macOS icon (generated)

**Regenerate icons:**
```bash
npm run tauri icon path/to/your-icon.png
```

### Build Optimization

**Strip debug symbols (Go/Wails):**

Pass ldflags at build time — no config file needed:

```bash
# Removes symbol table (-s), DWARF debug info (-w), and local build paths (-trimpath)
wails build -ldflags "-s -w" -trimpath
```

This alone cuts ~20–35% off the raw binary size.

**Optional UPX compression (additional −50–60%):**

```bash
# Requires UPX: https://upx.github.io/
upx --best --lzma build/bin/adOmnia.exe   # Windows
upx --best        build/bin/adOmnia        # Linux (--lzma may trigger AV on Windows)
```

> ⚠ Test on a machine with Windows Defender before distributing UPX-compressed builds.

**Frontend optimization:**

Lazy-loaded heavy panels (BrokerStudio, Database, gRPC, DockerLab, HAR Viewer) reduce JS parsed at startup by ~30–50%.

To analyze bundle sizes:
```bash
cd frontend
npm install --save-dev rollup-plugin-visualizer   # one-time
VITE_ANALYZE=1 npm run build                       # opens dist/bundle-report.html
```

**Legacy note — was `vite.config.ts`:**
```ts
export default defineConfig({
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
      },
    },
  },
})
```

---

## Troubleshooting

### Windows

**Error: `'cargo' is not recognized`**
```bash
# Install Rust
https://rustup.rs/

# Add to PATH
%USERPROFILE%\.cargo\bin
```

**Error: WebView2 runtime not found**
- Install from https://developer.microsoft.com/microsoft-edge/webview2/

**Error: `MSVC not found`**
- Install Visual Studio Build Tools with "Desktop development with C++"

---

### macOS

**Error: `xcode-select: command not found`**
```bash
xcode-select --install
```

**Error: Code signing failed**
- Ensure Apple Developer ID certificate installed
- Check signing identity: `security find-identity -v -p codesigning`

**Error: Gatekeeper blocks app**
```bash
# Remove quarantine attribute
xattr -d com.apple.quarantine adOmnia.app
```

---

### Linux

**Error: `gtk/gtk.h: No such file or directory`**
```bash
sudo apt-get install libgtk-3-dev
```

**Error: `webkit2/webkit2.h: No such file or directory`**
```bash
sudo apt-get install libwebkit2gtk-4.0-dev
```

**Error: `libayatana-appindicator3.so not found`**
```bash
sudo apt-get install libayatana-appindicator3-dev
```

**Runtime error: "cannot open display"**
- Ensure you're in a graphical environment (not SSH without X11 forwarding)

---

## CI/CD with GitHub Actions

### Example Workflow

Create `.github/workflows/build.yml`:

```yaml
name: Build

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - platform: 'windows-latest'
            args: ''
          - platform: 'macos-latest'
            args: '--target universal-apple-darwin'
          - platform: 'ubuntu-22.04'
            args: ''

    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install Linux dependencies
        if: matrix.platform == 'ubuntu-22.04'
        run: |
          sudo apt-get update
          sudo apt-get install -y libgtk-3-dev libwebkit2gtk-4.0-dev \
            libayatana-appindicator3-dev librsvg2-dev

      - name: Install Node dependencies
        run: npm ci

      - name: Build Tauri app
        uses: tauri-apps/tauri-action@v0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'adOmnia ${{ github.ref_name }}'
          releaseBody: 'See CHANGELOG.md for details'
          releaseDraft: true
          prerelease: false
          args: ${{ matrix.args }}
```

This workflow:
1. Triggers on version tags (`v1.0.0`)
2. Builds for Windows, macOS (universal), and Linux
3. Creates GitHub release with artifacts

---

## Advanced

### Custom Tauri Commands

Add new backend command in `src-tauri/src/commands/`:

```rust
// src-tauri/src/commands/myfeature.rs
#[tauri::command]
pub fn my_command(input: String) -> Result<String, String> {
    Ok(format!("Processed: {}", input))
}
```

Register in `src-tauri/src/lib.rs`:

```rust
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::myfeature::my_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Call from frontend:

```typescript
import { invoke } from '@tauri-apps/api/tauri'

const result = await invoke<string>('my_command', { input: 'test' })
```

---

## Build Size Optimization

| Method | Windows | macOS | Linux |
|--------|---------|-------|-------|
| **Default build** | ~8MB | ~12MB | ~10MB |
| **Optimized release** | ~5MB | ~8MB | ~7MB |
| **+ UPX compression** | ~2MB | N/A | ~3MB |

**Optimization checklist:**
- ✅ `strip = true` in `Cargo.toml`
- ✅ `opt-level = "z"` in `Cargo.toml`
- ✅ `lto = true` in `Cargo.toml`
- ✅ `minify: 'terser'` in `vite.config.ts`
- ✅ Remove unused dependencies
- ✅ Tree-shake frontend imports

---

## Next Steps

- Read [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines
- See [CHANGELOG.md](CHANGELOG.md) for version history
- Check [TAILWIND.md](../TAILWIND.md) for UI framework integration

---

## Questions?

Open an issue or discussion on GitHub: https://github.com/yourusername/adomnia/issues
