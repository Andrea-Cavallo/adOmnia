# Install adOmnia

adOmnia is distributed as pre-built desktop artifacts from GitHub Actions and GitHub Releases.

## Recommended Download

For normal users, download the latest stable build from:

[GitHub Releases](../releases/latest)

Release files:

| Platform | Artifact |
|---|---|
| Windows | `adOmnia-<version>-windows-amd64.exe` |
| Linux | `adOmnia-<version>-linux-amd64.tar.gz` or `adOmnia-<version>-linux-amd64` |
| macOS | `adOmnia-<version>-macos-universal.dmg` |

## CI Artifacts from Every Push

Every push to `main` or `develop` runs the desktop build workflow.

To download a CI build:

1. Open the repository on GitHub.
2. Go to **Actions**.
3. Open **Build Desktop Artifacts**.
4. Select the latest successful run.
5. Download artifacts from the **Artifacts** section.

Available artifact groups:

- `adOmnia-windows-amd64`
- `adOmnia-linux-amd64`
- `adOmnia-macos-universal`
- `adOmnia-desktop-artifacts` with the full bundle and `SHA256SUMS.txt`

## Windows

Download the `.exe` file and run it.

If Windows Defender SmartScreen warns about an unsigned application, choose the advanced option only if you trust the downloaded file and source. Code signing can be added later for a smoother install experience.

## macOS

Download the `.dmg`, open it, and drag `adOmnia.app` to Applications.

Unsigned builds may trigger Gatekeeper warnings. This is expected until notarized releases are configured.

## Linux

Download the `.tar.gz` package or standalone executable.

```bash
tar -xzf adOmnia-<version>-linux-amd64.tar.gz
chmod +x adOmnia
./adOmnia
```

Some distributions may require WebKitGTK/GTK runtime packages installed by the system package manager.

## Package managers

Package-manager templates are maintained in [`packaging/`](../packaging/README.md). The commands below apply after the bucket/tap or store entry is published. Scoop/Homebrew automation requires repository secrets; Snap Store and Flathub require separate publication. Availability has not been verified; use GitHub Releases for current downloads.

### Scoop (Windows)

```powershell
scoop bucket add adomnia https://github.com/Andrea-Cavallo/scoop-bucket
scoop install adomnia
```

### Homebrew (macOS and Linux)

```bash
brew tap Andrea-Cavallo/homebrew-tap
brew install --cask adomnia   # macOS
brew install adomnia          # Linuxbrew
```

### Snap (Linux)

```bash
snap install adomnia
```

### Flatpak (Linux)

```bash
flatpak install flathub com.adomnia.app
```

Package-manager builds are unsigned; macOS Gatekeeper, Windows SmartScreen or
Linux sandboxes may show warnings on first launch. See [`packaging/README.md`](../packaging/README.md)
for publishing details and caveats.
