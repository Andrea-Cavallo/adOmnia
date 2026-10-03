# Build adOmnia from Source

adOmnia is a Wails 3 desktop application with a Go backend and a React/TypeScript frontend.

## Requirements

- Go `1.26.5` (the version declared in `go.mod`)
- Node.js 22.13.0+ and npm
- Wails CLI `v3.0.0-beta.26`
- Native WebView development packages for the target OS

Install the pinned Wails CLI:

```bash
go install github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.26
```

## Development and checks

```bash
wails3 task dev
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run check:startup
go build ./... && go test ./...
```

## Production builds

The Taskfile is the canonical build interface. It generates bindings, builds the
frontend, and then builds the native executable for the current platform.

```bash
wails3 task build
wails3 task package
```

Set release metadata through environment variables:

```bash
VERSION=1.2.3 BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" GIT_COMMIT="$(git rev-parse HEAD)" wails3 task build
```

Windows produces `bin/adomnia.exe`. macOS packaging produces an `.app` bundle;
use `scripts/build-macos.sh <version>` on a macOS host for the universal DMG.

## Linux

Local builds (`./build.sh` or `wails3 task build`) use Wails 3's default
GTK4/WebKitGTK 6.0 backend:

```bash
sudo apt-get install build-essential libgtk-4-dev libwebkitgtk-6.0-dev pkg-config
./build.sh
./bin/adomnia
```

Linux selects `GDK_BACKEND=wayland` for Wayland sessions and `x11` for X11
sessions, regardless of the titlebar choice (no XWayland fallback). Legacy
`app-xwayland` settings load as `app`; workspace/settings schemas stay compatible.
With no detected session, GTK keeps its backend selection. App titlebar buttons
are currently frontend-rendered, not native `GtkWindowControls`. For native
theme shadows and rounded corners, select **System titlebar** and restart;
the exact decorations depend on GTK, the window manager and compositor.
Frameless app chrome does not inherit them.

Local builds do not install desktop entries or icons. GTK4 uses desktop
integration for the application icon: the project's `build/linux/adOmnia.desktop`
is packaged and installed as `adomnia.desktop`, with `Icon=adomnia` and
`StartupWMClass=adomnia`, matching the Linux program name (case-sensitive).
For a manually maintained desktop entry, use the filename `adomnia.desktop`,
point `Exec` to your binary and `Icon` to the installed icon name or an absolute
icon path. GTK4 windows also explicitly select the embedded `adomnia` icon from
an in-memory GTK icon resource, so the native window icon does not depend on
installing PNG files in the user's profile. Desktop launchers still use the
`.desktop` entry. After replacing `assets/icons/linux/adOmnia_256x256.png`,
regenerate the embedded resource with:

```bash
glib-compile-resources internal/nativeicon/icons.gresource.xml --sourcedir=assets/icons/linux --target=internal/nativeicon/icons.gresource
```

The Linux build disables GDK deprecation annotations
(`-DGDK_DISABLE_DEPRECATION_WARNINGS`) because Wails still uses deprecated X11
accessors for window placement. This suppresses those upstream warnings, not
other compiler diagnostics, and does not replace the deprecated APIs.

To explicitly test the compatibility backend instead:

```bash
LINUX_BUILD_TAGS='production gtk3' ./build.sh
```

Release packaging deliberately selects the supported `gtk3` compatibility tag,
which links against GTK3/WebKitGTK 4.1 and is available on current LTS
distributions and CI runners.

```bash
sudo apt-get install build-essential libayatana-appindicator3-dev libgtk-3-dev libwebkit2gtk-4.1-dev pkg-config
bash build/linux/package-native-tarballs.sh 1.2.3
```

The package is named `adomnia-<version>-linux-amd64-gtk3-webkitgtk-4.1.tar.gz`.

## CI releases

The release workflows build Windows, Linux GTK3/WebKitGTK 4.1 and universal
macOS artifacts on their native runners. Cross-compiling macOS desktop builds
from Windows or Linux is not supported because Wails needs Xcode and CGO.
