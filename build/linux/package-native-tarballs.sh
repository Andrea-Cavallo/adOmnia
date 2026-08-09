#!/usr/bin/env bash
# Build and package the portable Wails 3 GTK3/WebKitGTK 4.1 Linux target.
# The Wails 3 default uses GTK4/WebKitGTK 6.0; GTK3 keeps the release usable
# on supported LTS distributions and is the target used by the CI runners.
set -euo pipefail

VERSION="${1:?Usage: $0 <version> [artifact-suffix]}"
ARTIFACT_SUFFIX="${2:-}"

APP_NAME="${APP_NAME:-adomnia}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
GIT_COMMIT="${GIT_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"
COMPRESS_WITH_UPX="${COMPRESS_WITH_UPX:-0}"

mkdir -p dist

package_tarball() {
    local variant="$1"
    local readme_note="$2"
    local basename="${APP_NAME}-${VERSION}-linux-amd64-${variant}${ARTIFACT_SUFFIX}"
    local stage="dist/${basename}"

    rm -rf "$stage"
    mkdir -p "$stage/icons"

    cp bin/adomnia "$stage/adomnia"
    chmod +x "$stage/adomnia"

    for size in 16 24 32 48 64 128 256 512; do
        icon="assets/icons/linux/adOmnia_${size}x${size}.png"
        if [ -f "$icon" ]; then
            cp "$icon" "$stage/icons/"
        fi
    done

    if [ -f assets/icons/linux/adOmnia_256x256.png ]; then
        cp assets/icons/linux/adOmnia_256x256.png "$stage/adomnia.png"
    fi

    if [ -f build/linux/adOmnia.desktop ]; then
        cp build/linux/adOmnia.desktop "$stage/adomnia.desktop"
    elif [ -f build/linux/adomnia.desktop ]; then
        cp build/linux/adomnia.desktop "$stage/adomnia.desktop"
    else
        echo "Missing Linux desktop entry: build/linux/adOmnia.desktop" >&2
        exit 1
    fi

    if [ -f build/linux/install.sh ]; then
        cp build/linux/install.sh "$stage/"
        chmod +x "$stage/install.sh"
    fi

    if [ -f build/linux/uninstall.sh ]; then
        cp build/linux/uninstall.sh "$stage/"
    else
        {
            printf '%s\n' '#!/usr/bin/env bash'
            printf '%s\n' 'set -e'
            printf '%s\n' 'if [ "$(id -u)" -ne 0 ]; then'
            printf '%s\n' '    echo "Run with sudo: sudo ./uninstall.sh"'
            printf '%s\n' '    exit 1'
            printf '%s\n' 'fi'
            printf '%s\n' 'rm -rf /opt/adomnia'
            printf '%s\n' 'rm -f /usr/share/applications/adomnia.desktop'
            printf '%s\n' 'for sz in 16 24 32 48 64 128 256 512; do'
            printf '%s\n' '    rm -f "/usr/share/icons/hicolor/${sz}x${sz}/apps/adomnia.png"'
            printf '%s\n' 'done'
            printf '%s\n' 'gtk-update-icon-cache -f -t /usr/share/icons/hicolor 2>/dev/null || true'
            printf '%s\n' 'xdg-icon-resource forceupdate 2>/dev/null || true'
            printf '%s\n' 'update-desktop-database /usr/share/applications 2>/dev/null || true'
            printf '%s\n' 'echo "adOmnia removed."'
        } > "$stage/uninstall.sh"
    fi
    chmod +x "$stage/uninstall.sh"

    {
        printf '%s\n' 'adOmnia native Linux build'
        printf '\n'
        printf 'Variant: %s\n' "$variant"
        printf '%s\n' "$readme_note"
        printf '\n'
        printf '%s\n' 'This tarball contains a native Linux amd64 executable. The GTK and'
        printf '%s\n' 'WebKitGTK runtime matching the variant above must be available on the'
        printf '%s\n' 'target system.'
    } > "$stage/README-linux.txt"

    tar -czf "dist/${basename}.tar.gz" -C "$stage" .
    sha256sum "dist/${basename}.tar.gz" > "dist/${basename}.tar.gz.sha256"
    rm -rf "$stage"
}

build_and_package() {
    local variant="$1"
    local readme_note="$2"

    # The frontend is identical across variants, so build it once up front and
    # only re-link the Go binary per target.
    VERSION="${VERSION}" BUILD_DATE="${BUILD_DATE}" GIT_COMMIT="${GIT_COMMIT}" \
        GOFLAGS="-tags=gtk3" \
        wails3 task linux:build

    if [ "$COMPRESS_WITH_UPX" = "1" ]; then
        upx --best --lzma bin/adomnia
    fi

    package_tarball "$variant" "$readme_note"
}

build_and_package \
    "gtk3-webkitgtk-4.1" \
    "Built against GTK 3 and WebKitGTK 4.1 using the Wails 3 build tag gtk3."
