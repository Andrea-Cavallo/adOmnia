#!/usr/bin/env bash
# Build and package native Linux tarballs for both Wails WebKitGTK targets.
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

    cp build/bin/adomnia "$stage/adomnia"
    chmod +x "$stage/adomnia"

    for size in 16 24 32 48 64 128 256 512; do
        icon="assets/icons/linux/adomnia_${size}x${size}.png"
        if [ -f "$icon" ]; then
            cp "$icon" "$stage/icons/"
        fi
    done

    if [ -f assets/icons/linux/adomnia_256x256.png ]; then
        cp assets/icons/linux/adomnia_256x256.png "$stage/adomnia.png"
    fi

    if [ -f build/linux/adomnia.desktop ]; then
        cp build/linux/adomnia.desktop "$stage/"
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
        printf '%s\n' 'This tarball contains a native Linux amd64 executable. GTK 3 and the'
        printf '%s\n' 'matching WebKitGTK runtime must be available on the target system.'
    } > "$stage/README-linux.txt"

    tar -czf "dist/${basename}.tar.gz" -C "$stage" .
    sha256sum "dist/${basename}.tar.gz" > "dist/${basename}.tar.gz.sha256"
    rm -rf "$stage"
}

build_and_package() {
    local variant="$1"
    local readme_note="$2"
    shift 2

    wails build \
        -clean \
        -platform linux/amd64 \
        -trimpath \
        "$@" \
        -ldflags "-s -w -X main.Version=${VERSION} -X main.BuildDate=${BUILD_DATE} -X main.GitCommit=${GIT_COMMIT}"

    if [ "$COMPRESS_WITH_UPX" = "1" ]; then
        upx --best --lzma build/bin/adomnia
    fi

    package_tarball "$variant" "$readme_note"
}

build_and_package \
    "webkitgtk-4.0" \
    "Built against WebKitGTK 4.0 using the default Wails Linux target."

build_and_package \
    "webkitgtk-4.1" \
    "Built against WebKitGTK 4.1 using the Wails build tag webkit2_41." \
    -tags webkit2_41
