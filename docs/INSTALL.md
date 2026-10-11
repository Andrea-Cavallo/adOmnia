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

## Install or update with a script

Official releases also include `install.sh` and `install.ps1`. Download the script,
inspect it, then run it; do not pipe remote code directly into a shell.
From a repository checkout:

```bash
# Linux x86_64: installs to ~/.local/bin/adomnia
# macOS: installs to ~/Applications/adomnia.app
bash scripts/install.sh
# Pin a release or update a custom, user-owned copy
bash scripts/install.sh --version v0.10.0 --destination "$HOME/.local/bin/adomnia"
```

```powershell
# Windows x86_64: installs to %LOCALAPPDATA%\Programs\adOmnia\adomnia.exe
.\scripts\install.ps1
.\scripts\install.ps1 -Version v0.10.0 -Destination 'C:\Users\me\Apps\adomnia.exe'
```

Both scripts select the latest stable release by default, ask for confirmation
before downloading the application, and verify SHA-256 against the release's
`SHA256SUMS.txt` before replacing anything. `--yes` / `-Yes` is explicit consent
for unattended use. An explicit version can also select a prerelease or downgrade;
there is no automatic version comparison in the scripts.

Close adOmnia first. Scripts do not request elevation, install system dependencies,
modify PATH, or change workspaces/settings. Linux/macOS require Bash, curl, Python 3,
unzip and pgrep; Windows requires PowerShell 5.1+. Linux still needs the GTK3 /
WebKitGTK 4.1 runtime described in the build guide. For system/package-manager
installations, use that package manager instead.

An existing application is retained as `PATH.adomnia-previous`. After verifying
the new application, remove that backup before another update. If it fails to
launch, remove the new application and rename the backup to its original path.
Script installs do **not** have automatic startup rollback. SHA-256 downloaded
from the same release detects corruption, not compromise of the release account;
unlike the in-app updater, these scripts do not verify the Ed25519 manifest.

## Updates inside adOmnia

Use **Settings → Check now**, then **Download update**. New installations default
to asking before downloading; existing explicit automatic-download preferences
remain compatible. Automatic downloads can be enabled separately in Settings,
but never authorize installation.

After signature and checksum verification, choose **Save & restart** or **Install
on exit**. **Later** leaves the application unchanged unless you have explicitly
scheduled installation. The updater preserves local data, retains the previous
application during startup, and restores it if the new build does not confirm
successful startup. Development builds and system-managed Linux copies cannot
self-update. The installed build must trust the signing key used by the release;
releases without `update-manifest.json` are not offered for in-app installation.

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

To install the tarball's executable, launcher and icons for your user:

```bash
./install.sh       # no sudo
# Later, remove application files without deleting your workspaces/settings:
./uninstall.sh     # no sudo
```

The executable is installed at `~/.local/bin/adomnia`. The desktop entry and
icons go under `${XDG_DATA_HOME:-~/.local/share}`. Launch from the desktop menu
or run `~/.local/bin/adomnia` (bare `adomnia` also works if `~/.local/bin` is on
PATH). This user-owned installation supports in-app updates without elevation.
Close adOmnia before reinstalling or uninstalling. Both scripts reject `sudo`.

**Migration from older tarballs:** `/opt/adomnia` and system-wide launchers/icons
are left untouched. After verifying the user installation, use the **old**
tarball's `sudo ./uninstall.sh` to remove the legacy system copy. The new
uninstaller removes only user-installed files and preserves application data.

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
