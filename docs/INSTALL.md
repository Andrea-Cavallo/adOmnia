# Install adOmnia

adOmnia is distributed as pre-built desktop artifacts from GitHub Actions and GitHub Releases.

## Recommended Download

For normal users, download the latest stable build from:

[GitHub Releases](https://github.com/Andrea-Cavallo/adOmnia/releases/latest)

Release files:

| Platform | Artifact |
|---|---|
| Windows (installer, recommended) | [`adomnia-<version>-windows-amd64-setup.exe`](https://github.com/Andrea-Cavallo/adOmnia/releases/latest) |
| Windows (portable) | [`adomnia-<version>-windows-amd64.exe`](https://github.com/Andrea-Cavallo/adOmnia/releases/latest) |
| Linux | [`adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz`](https://github.com/Andrea-Cavallo/adOmnia/releases/latest) |
| macOS | [`adomnia-<version>-macos-universal.dmg`](https://github.com/Andrea-Cavallo/adOmnia/releases/latest) |

## Install or update with a script

Official releases also include `install.sh` and `install.ps1`. Download the script,
inspect it, then run it; do not pipe remote code directly into a shell.
From a repository checkout:

```bash
# Linux x86_64: installs to ~/.local/bin/adomnia
# macOS: installs to ~/Applications/adomnia.app
bash scripts/install.sh
# Pin a release or update a custom, user-owned copy
bash scripts/install.sh --version v1.0.0 --destination "$HOME/.local/bin/adomnia"
```

```powershell
# Windows x86_64: installs to %LOCALAPPDATA%\Programs\adOmnia\adomnia.exe
.\scripts\install.ps1
.\scripts\install.ps1 -Version v1.0.0 -Destination 'C:\Users\me\Apps\adomnia.exe'
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

adOmnia checks GitHub Releases at startup and every six hours while open
(**Settings → Automatic updates**). A newer signed release downloads in the
background by default; turn **Download verified updates in the background** off to
download only when you click **Download update**. Downloading never installs.

After the Ed25519 signature and the SHA-256 checksum are verified, choose **Save &
restart** or **Install on exit**. **Later** leaves the application unchanged. The
updater keeps your local data, keeps the previous application while the new one
starts, and restores it if the new build does not confirm a successful startup.

How adOmnia updates depends on how it was installed; Settings shows which case applies:

| Installed with | In-app update |
|---|---|
| Windows installer (`setup.exe`) | Replaces `adomnia.exe` in place and updates the version shown in **Installed apps** |
| Portable `.exe`, `install.ps1`, `install.sh`, Linux tarball `install.sh` | Replaces the executable in place |
| macOS `.app` in a folder you can write to | Replaces `adomnia.app` |
| Read-only folder, `/usr`, `/opt`, Snap, Flatpak, Scoop/Homebrew | Not possible: adOmnia shows the release and a download link instead |

Development builds never update. The installed build must trust the signing key
used by the release; releases without `update-manifest.json` are not offered.

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

**Installer (recommended).** Run `adomnia-<version>-windows-amd64-setup.exe`.

- Installs for your Windows account only, in `%LOCALAPPDATA%\Programs\adOmnia`: no administrator rights, no UAC prompt.
- Adds a Start menu shortcut and, if you keep the option, a desktop shortcut.
- Registers adOmnia in **Settings → Apps → Installed apps**, with its version and an uninstaller.
- Running a newer setup over an installed copy upgrades it. Workspaces, collections and settings are kept.
- If the Microsoft Edge WebView2 Runtime is missing, the installer says so and offers Microsoft's download page.
- The uninstaller removes the application and shortcuts. It deletes your data (`%APPDATA%\adomnia`) only if you tick **Also delete my data**.

Unattended install or upgrade: `adomnia-<version>-windows-amd64-setup.exe /S`.
Unattended uninstall: `"%LOCALAPPDATA%\Programs\adOmnia\uninstall.exe" /S` (always keeps your data).

**Portable.** Download `adomnia-<version>-windows-amd64.exe` and run it from any folder you can write to.

Releases are Authenticode-signed only when the repository has a code-signing certificate configured. Without a signature, SmartScreen may show "Windows protected your PC": choose **More info → Run anyway**, but only for a file you downloaded from this repository's releases, and compare it with `SHA256SUMS.txt` if you want to be sure. The in-app updater always verifies its own publisher signature and checksum.

## macOS

Download the `.dmg`, open it, and drag `adomnia.app` to Applications.

Binaries are not notarized yet, so Gatekeeper may block the first launch. Right-click the app and choose **Open** once, or run `xattr -dr com.apple.quarantine /Applications/adomnia.app`.

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
