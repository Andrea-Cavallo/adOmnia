#!/bin/bash
#
# build-wails.sh — Multi-platform Wails build for adOmnia
#
# Run from project root:
#   ./build/build-wails.sh              # Windows (current host)
#   ./build/build-wails.sh all          # All platforms
#   ./build/build-wails.sh windows      # Windows AMD64
#   ./build/build-wails.sh macos        # macOS Intel + ARM64
#   ./build/build-wails.sh linux        # Linux AMD64
#   ./build/build-wails.sh all 1.2.3    # All platforms with version tag
#
# Requirements:
#   - Go 1.22+
#   - Wails CLI v2 (go install github.com/wailsapp/wails/v2/cmd/wails@latest)
#   - Node.js 18+ and npm
#   - Windows cross-compile: MinGW-w64 (x86_64-w64-mingw32-gcc)
#   - macOS cross-compile:   must run on macOS host (CGO restriction)
#   - Linux cross-compile:   must run on Linux host or use Docker
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

TARGET="${1:-current}"
VERSION="${2:-dev}"
OUT_DIR="dist"
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   adOmnia Wails Build Script           ║${NC}"
echo -e "${CYAN}║   Target: $TARGET  Version: $VERSION       ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# ── Preflight checks ──────────────────────────────────────────────────────────

if ! command -v go &>/dev/null; then
    echo -e "${RED}❌ Go not found. Install from https://go.dev/dl/${NC}"; exit 1
fi
echo -e "${GREEN}✓${NC} Go: $(go version | awk '{print $3}')"

if ! command -v wails &>/dev/null; then
    echo -e "${YELLOW}⚠️  Wails CLI not found in PATH, checking GOPATH/bin...${NC}"
    WAILS_BIN="$(go env GOPATH)/bin/wails"
    if [ ! -x "$WAILS_BIN" ]; then
        echo -e "${RED}❌ Wails not installed.${NC}"
        echo "  Run: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
        exit 1
    fi
else
    WAILS_BIN="wails"
fi
echo -e "${GREEN}✓${NC} Wails: $($WAILS_BIN version 2>/dev/null | head -1)"

mkdir -p "$OUT_DIR"

# ── Icon generation ───────────────────────────────────────────────────────────

ICON_SCRIPT="scripts/generate-icons.sh"
if [ -f "$ICON_SCRIPT" ]; then
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🎨  Generating icons...${NC}"
    bash "$ICON_SCRIPT"
    echo ""
else
    echo -e "${YELLOW}⚠️  $ICON_SCRIPT not found — skipping icon generation${NC}"
fi

# ── Helpers ───────────────────────────────────────────────────────────────────

build_platform() {
    local PLATFORM="$1"     # e.g. windows/amd64
    local OUTPUT="$2"       # e.g. dist/adomnia-windows-amd64.exe
    local LDFLAGS="-s -w -X main.Version=${VERSION} -X main.GitCommit=${GIT_COMMIT}"

    echo -e "${YELLOW}→${NC} Building $PLATFORM..."
    "$WAILS_BIN" build \
        -platform "$PLATFORM" \
        -ldflags "$LDFLAGS" \
        -o "$(pwd)/$OUTPUT" 2>&1 | grep -v "^[[:space:]]*$" || true

    if [ -f "$OUTPUT" ]; then
        SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} $OUTPUT ($SIZE)"
    else
        echo -e "${RED}✗${NC} Build failed for $PLATFORM"
        return 1
    fi
}

# ── Platform targets ──────────────────────────────────────────────────────────

build_windows() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🪟  Windows${NC}"
    if [ "$(uname -s)" != "Windows_NT" ] && [ "$(uname -s)" != "MINGW"* ]; then
        if ! command -v x86_64-w64-mingw32-gcc &>/dev/null; then
            echo -e "${YELLOW}⚠️  MinGW not found — Windows cross-compile requires x86_64-w64-mingw32-gcc${NC}"
            echo "   macOS:  brew install mingw-w64"
            echo "   Debian: sudo apt install gcc-mingw-w64-x86-64"
            return 1
        fi
    fi
    build_platform "windows/amd64" "$OUT_DIR/adomnia-windows-amd64.exe"
}

build_macos() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🍎  macOS${NC}"
    if [ "$(uname -s)" != "Darwin" ]; then
        echo -e "${YELLOW}⚠️  macOS builds require a macOS host (CGO limitation)${NC}"
        return 1
    fi
    build_platform "darwin/amd64" "$OUT_DIR/adomnia-darwin-amd64"
    build_platform "darwin/arm64" "$OUT_DIR/adomnia-darwin-arm64"

    if [ -f "$OUT_DIR/adomnia-darwin-amd64" ] && [ -f "$OUT_DIR/adomnia-darwin-arm64" ]; then
        echo -e "${YELLOW}→${NC} Creating universal binary..."
        lipo -create -output "$OUT_DIR/adomnia-darwin-universal" \
            "$OUT_DIR/adomnia-darwin-amd64" \
            "$OUT_DIR/adomnia-darwin-arm64"
        SIZE=$(ls -lh "$OUT_DIR/adomnia-darwin-universal" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} adomnia-darwin-universal ($SIZE)"
    fi
}

build_linux() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🐧  Linux${NC}"
    if [ "$(uname -s)" != "Linux" ]; then
        echo -e "${YELLOW}⚠️  Linux Wails builds require a Linux host (WebKitGTK CGO dependency)${NC}"
        echo "   Use the Dockerfile: docker build -f build/Dockerfile -t adomnia-build ."
        return 1
    fi
    build_platform "linux/amd64" "$OUT_DIR/adomnia-linux-amd64"
}

create_checksums() {
    echo -e "${CYAN}🔐  Checksums...${NC}"
    cd "$OUT_DIR"
    sha256sum adomnia-* > SHA256SUMS.txt 2>/dev/null || \
        shasum -a 256 adomnia-* > SHA256SUMS.txt 2>/dev/null || true
    cd - >/dev/null
    echo -e "${GREEN}✓${NC} $OUT_DIR/SHA256SUMS.txt"
}

# ── Main ──────────────────────────────────────────────────────────────────────

case "$TARGET" in
    all)
        build_windows  || echo -e "${YELLOW}⚠️  Windows skipped${NC}"
        build_macos    || echo -e "${YELLOW}⚠️  macOS skipped${NC}"
        build_linux    || echo -e "${YELLOW}⚠️  Linux skipped${NC}"
        create_checksums
        ;;
    windows)
        build_windows
        create_checksums
        ;;
    macos)
        build_macos
        create_checksums
        ;;
    linux)
        build_linux
        create_checksums
        ;;
    current)
        OS=$(uname -s | tr '[:upper:]' '[:lower:]')
        case $OS in
            darwin)  build_macos   ;;
            linux)   build_linux   ;;
            *)       build_windows ;;
        esac
        create_checksums
        ;;
    *)
        echo -e "${RED}❌ Unknown target: $TARGET${NC}"
        echo "Usage: $0 [current|all|windows|macos|linux] [version]"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}✅  Build complete!${NC}"
echo ""
ls -lh "$OUT_DIR/" 2>/dev/null | tail -n +2 || true
echo ""
echo -e "${CYAN}Next:${NC}"
echo "  Test: open $OUT_DIR/"
echo "  Release: gh release create v$VERSION ./$OUT_DIR/*"
