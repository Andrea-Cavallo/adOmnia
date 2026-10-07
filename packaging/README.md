# Packaging & distribution channels

adOmnia ships portable artifacts from GitHub Releases (see `docs/BUILD.md`).
This directory holds the manifests that publish adOmnia to package managers, so
users can install it with `brew`, `scoop`, `snap` or `flatpak` instead of
downloading a binary by hand.

The manifest files are **templates**: `__VERSION__` and `__SHA256_*__` are
placeholders replaced by the release automation (`.github/workflows/packaging.yml`)
or by hand (see "Update a manifest by hand" below).

| Channel | Manifest | Repo the file must live in | Store account needed |
|---|---|---|---|
| Scoop (Windows) | `scoop/adomnia.json` | `Andrea-Cavallo/scoop-bucket` (bucket) | no |
| Homebrew (macOS) | `homebrew/Casks/adomnia.rb` | `Andrea-Cavallo/homebrew-tap` (tap) | no |
| Homebrew (Linuxbrew) | `homebrew/Formula/adomnia.rb` | same tap | no |
| Snap (Linux) | `snap/snapcraft.yaml` | this repo (built by snapcraft) | yes (Snap Store) |
| Flatpak (Linux) | `flatpak/com.adomnia.app.yml` | this repo or a dedicated flatpak repo | yes (Flathub) |

## Versioning

`__VERSION__` is the release version **without** the leading `v` (e.g. `0.9.65`).
Release asset URLs follow the pattern in `.github/workflows/release.yml`:

- Windows: `adomnia-<version>-windows-amd64.exe`
- Linux: `adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz`
- macOS: `adomnia-<version>-macos-universal.dmg`

The placeholders map to per-asset SHA-256 checksums:

- `__SHA256_WINDOWS__` → the `.exe` (Scoop)
- `__SHA256_LINUX__` → the Linux tarball (Homebrew formula, Snap, Flatpak)
- `__SHA256_MACOS__` → the DMG (Homebrew cask)

## Scoop

1. Create the bucket repo `Andrea-Cavallo/scoop-bucket` and put `adomnia.json`
   at the root (a bucket is just a git repo of manifests).
2. Fill `__VERSION__` and set `"hash": "sha256:<hex>"`.
3. Users install with:

   ```powershell
   scoop bucket add adomnia https://github.com/Andrea-Cavallo/scoop-bucket
   scoop install adomnia
   ```

   The `checkver`/`autoupdate` blocks let `scoop update adomnia` and
   `bin/checkver.ps1 -u` bump the manifest automatically.

## Homebrew

1. Create the tap repo `Andrea-Cavallo/homebrew-tap` (a tap is a git repo
   named `homebrew-<name>` containing `Casks/` and/or `Formula/`).
2. macOS users install the cask, Linux users the formula:

   ```bash
   brew tap Andrea-Cavallo/homebrew-tap
   brew install --cask adomnia   # macOS
   brew install adomnia          # Linuxbrew
   ```

   The cask/formula are unsigned for now, so Gatekeeper / Linux packaging may
   warn. Bump a release with `brew bump-cask-pr adomnia --version <ver>` or let
   the CI workflow push the updated manifest.

## Snap

`snap/snapcraft.yaml` packages the prebuilt Linux tarball. Build and publish:

```bash
sudo snap install snapcraft --classic
snapcraft login          # Snap Store account, once
cd packaging/snap
snapcraft                # builds adomnia_<version>_amd64.snap
snapcraft upload --release=stable adomnia_<version>_amd64.snap
```

Notes:

- The app is confined (`confinement: strict`) and plugs the desktop, network,
  x11/wayland and home interfaces. `stage-packages` bundles GTK 3 / WebKitGTK
  4.1 so the prebuilt binary resolves its runtime.
- Publishing requires a Canonical account and registering the `adomnia` name.

## Flatpak

`flatpak/com.adomnia.app.yml` packages the prebuilt tarball against the
`org.gnome.Platform//46` runtime (which carries WebKitGTK 4.1). Build and run
locally without Flathub:

```bash
flatpak-builder --user --install --force-clean builddir com.adomnia.app.yml
flatpak run com.adomnia.app
```

Notes:

- This manifest downloads the release tarball at build time (checksummed). It is
  suitable for a self-hosted remote.
- **Flathub requires building from source** (no network downloads at install,
  reproducible source builds). `flatpak/com.adomnia.app.source.yml` is the
  source-build manifest for that path; it needs `go mod vendor` and a vendored
  `node_modules` committed to the repo before it builds offline (see the header
  comments in that file), plus a Flathub submission and review.

## Update a manifest by hand

For a given `<version>`, run the bundled renderer (Git Bash / WSL / Linux / macOS):

```bash
bash packaging/render.sh 0.9.65
```

It downloads the three release assets, computes their SHA-256 checksums and
writes the finished manifests into `out/` (Scoop `adomnia.json`, Homebrew
`Casks-adomnia.rb` and `Formula-adomnia.rb`, plus `snapcraft.yaml` and
`com.adomnia.app.yml`). Drop those into the bucket/tap repos or use them for
`snapcraft` / `flatpak-builder`.

Or by hand: download the three assets, then

```bash
v=<version>
sha256sum adomnia-$v-windows-amd64.exe
sha256sum adomnia-$v-linux-amd64-gtk3-webkitgtk-4.1.tar.gz
sha256sum adomnia-$v-macos-universal.dmg
```

and replace `__VERSION__`, `__SHA256_WINDOWS__` (`sha256:<hex>` for Scoop),
`__SHA256_LINUX__` and `__SHA256_MACOS__` in the matching manifests.

## Automation

`.github/workflows/packaging.yml` runs when a GitHub Release is published: it
downloads the three assets, computes their checksums, renders the Scoop and
Homebrew manifests from these templates, and pushes them to the configured
bucket/tap repos. Set the repository secrets `SCOOP_BUCKET_REPO`,
`HOMEBREW_TAP_REPO` and `PACKAGING_PAT` (a fine-grained token with write access
to those repos) to enable it. Snap and Flatpak are not auto-published: Snap
needs `snapcraft upload` from a machine logged into the store, and Flatpak/Flathub
needs a source build and review.
