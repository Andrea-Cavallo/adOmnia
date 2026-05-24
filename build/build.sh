#!/bin/bash
#
# build.sh - Multi-platform build script for adOmnia
#
# Run from project root OR build/:
#   ./build/build.sh              # Build current platform only
#   ./build/build.sh all          # Build all platforms
#   ./build/build.sh windows      # Build Windows only
#   ./build/build.sh macos        # Build macOS (Intel + ARM)
#   ./build/build.sh linux        # Build Linux only
#   ./build/build.sh all 1.0.0    # Build all with version number
#
# On Windows: prefer running .\build.ps1 from PowerShell (simpler, no WSL quirks).

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

VERSION=${2:-"dev"}
BUILD_DIR="dist"
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     adOmnia Build Script v$VERSION        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# ── WSL detection ─────────────────────────────────────────────────────────────
_in_wsl() { [[ -n "${WSL_DISTRO_NAME:-}" ]] || [[ -n "${WSLENV:-}" ]]; }

# ── Go binary detection ───────────────────────────────────────────────────────
# In WSL the distro-packaged Go is often outdated; prefer Windows-native Go.
GO=""
if [[ -x "/mnt/c/Program Files/Go/bin/go.exe" ]]; then
    GO="/mnt/c/Program Files/Go/bin/go.exe"
elif [[ -x "/mnt/c/Go/bin/go.exe" ]]; then
    GO="/mnt/c/Go/bin/go.exe"
elif command -v go.exe &>/dev/null; then
    GO="go.exe"
elif command -v go &>/dev/null; then
    GO="go"
fi

if [[ -z "$GO" ]]; then
    echo -e "${RED}❌ Error: Go is not installed${NC}"
    echo "Download from: https://golang.org/dl/"
    exit 1
fi
echo -e "${GREEN}✓${NC} Go: $("$GO" version | awk '{print $3}')"

# ── Node.js / npm detection ───────────────────────────────────────────────────
# In WSL, npm.cmd/.ps1 cannot run in bash.
# Fix: use cmd.exe to call npm — cmd.exe handles .cmd files and Windows PATH.
# node.exe is only needed for `node --version`; npm is always run via cmd.exe in WSL.
NODE_CMD=()
NPM_CMD=()

WIN_CMD="/mnt/c/Windows/System32/cmd.exe"

if _in_wsl; then
    # Detect Windows node.exe for the version check
    if [[ -x "/mnt/c/Program Files/nodejs/node.exe" ]]; then
        NODE_CMD=("/mnt/c/Program Files/nodejs/node.exe")
    elif command -v node.exe &>/dev/null; then
        NODE_CMD=(node.exe)
    elif command -v node &>/dev/null; then
        NODE_CMD=(node)
    fi
    # In WSL, always use cmd.exe to run npm — avoids .cmd/.ps1 execution issues
    if [[ -x "$WIN_CMD" ]]; then
        NPM_CMD=("$WIN_CMD" "/c" "npm")
    else
        NPM_CMD=(npm)
        echo -e "${YELLOW}⚠️  cmd.exe not found at $WIN_CMD — npm may fail${NC}"
    fi
elif command -v node.exe &>/dev/null; then
    # Git Bash / non-WSL: npm.cmd is handled by Git Bash via cmd.exe automatically
    NODE_CMD=(node.exe)
    NPM_CMD=(npm)
elif command -v node &>/dev/null; then
    # Native Linux/macOS
    NODE_CMD=(node)
    NPM_CMD=(npm)
fi

if [[ ${#NODE_CMD[@]} -eq 0 ]]; then
    echo -e "${RED}❌ Error: Node.js is not installed${NC}"
    echo "Download from: https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js: $("${NODE_CMD[@]}" --version 2>/dev/null || echo unknown)"

# Go version check
GO_VER=$("$GO" version | awk '{print $3}')
GO_MINOR=$(echo "$GO_VER" | sed 's/go1\.//' | cut -d. -f1)
if [[ "$GO_MINOR" -lt 22 ]] 2>/dev/null; then
    echo -e "${RED}❌ Go 1.22+ required. Found: $GO_VER${NC}"
    echo "  Download: https://go.dev/dl/"
    if _in_wsl; then
        echo -e "${YELLOW}  TIP: Run .\\build.ps1 from Windows PowerShell instead.${NC}"
    fi
    exit 1
fi

# Build flags
BASE_LDFLAGS="-s -w"
VERSION_LDFLAGS="$BASE_LDFLAGS -X main.Version=$VERSION -X main.BuildDate=$BUILD_DATE -X main.GitCommit=$GIT_COMMIT"

echo -e "${GREEN}✓${NC} Build version: $VERSION"
echo -e "${GREEN}✓${NC} Git commit: $GIT_COMMIT"
echo ""

# ── Build frontend ────────────────────────────────────────────────────────────
build_frontend() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}📦  Building frontend...${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    cd "$SCRIPT_DIR/frontend"

    if [ ! -d "node_modules" ]; then
        echo -e "${YELLOW}→${NC} Installing frontend dependencies..."
        "${NPM_CMD[@]}" install --silent
    fi

    echo -e "${YELLOW}→${NC} Running npm run build..."
    "${NPM_CMD[@]}" run build

    if [ ! -d "dist" ]; then
        echo -e "${RED}❌ Frontend build failed — dist/ not found${NC}"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Frontend built."

    cd "$SCRIPT_DIR"
}

# Clean previous builds
clean_build_dir() {
    if [ -d "$BUILD_DIR" ]; then
        echo -e "${YELLOW}🗑️  Cleaning previous builds...${NC}"
        rm -rf "$BUILD_DIR"
    fi
    mkdir -p "$BUILD_DIR"
}

# Build Windows
build_windows() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🪟  Building for Windows...${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if ! command -v x86_64-w64-mingw32-gcc &>/dev/null; then
        echo -e "${YELLOW}⚠️  MinGW not found — required for Windows CGO cross-compilation${NC}"
        echo "  macOS: brew install mingw-w64"
        echo "  Linux: sudo apt-get install gcc-mingw-w64-x86-64"
        if [[ "$(uname -s)" == "Darwin" || "$(uname -s)" == "Linux" ]]; then
            echo -e "${RED}❌ Cannot cross-compile Windows binary without MinGW${NC}"
            return 1
        fi
    fi

    echo -e "${YELLOW}→${NC} Building Windows AMD64..."
    GOOS=windows GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-w64-mingw32-gcc \
        "$GO" build -ldflags "$VERSION_LDFLAGS -H windowsgui" \
        -o "$BUILD_DIR/adomnia-windows-amd64.exe" .

    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$BUILD_DIR/adomnia-windows-amd64.exe" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} adomnia-windows-amd64.exe ($SIZE)"
    else
        echo -e "${RED}✗${NC} Windows build failed"
        return 1
    fi
}

# Build macOS
build_macos() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🍎  Building for macOS...${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [ "$(uname -s)" != "Darwin" ]; then
        echo -e "${YELLOW}⚠️  Cross-compiling macOS binary from non-macOS host${NC}"
    fi

    echo -e "${YELLOW}→${NC} Building macOS Intel (AMD64)..."
    GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 \
        "$GO" build -ldflags "$VERSION_LDFLAGS" \
        -o "$BUILD_DIR/adomnia-darwin-amd64" .

    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$BUILD_DIR/adomnia-darwin-amd64" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} adomnia-darwin-amd64 ($SIZE)"
    else
        echo -e "${RED}✗${NC} macOS AMD64 build failed"
        return 1
    fi

    echo -e "${YELLOW}→${NC} Building macOS Apple Silicon (ARM64)..."
    GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 \
        "$GO" build -ldflags "$VERSION_LDFLAGS" \
        -o "$BUILD_DIR/adomnia-darwin-arm64" .

    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$BUILD_DIR/adomnia-darwin-arm64" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} adomnia-darwin-arm64 ($SIZE)"
    else
        echo -e "${RED}✗${NC} macOS ARM64 build failed"
        return 1
    fi

    if [ -f "$BUILD_DIR/adomnia-darwin-amd64" ] && [ -f "$BUILD_DIR/adomnia-darwin-arm64" ]; then
        echo -e "${YELLOW}→${NC} Creating universal binary..."
        lipo -create -output "$BUILD_DIR/adomnia-darwin-universal" \
            "$BUILD_DIR/adomnia-darwin-amd64" \
            "$BUILD_DIR/adomnia-darwin-arm64"
        if [ $? -eq 0 ]; then
            SIZE=$(ls -lh "$BUILD_DIR/adomnia-darwin-universal" | awk '{print $5}')
            echo -e "${GREEN}✓${NC} adomnia-darwin-universal ($SIZE)"
        fi
    fi
}

# Build Linux
build_linux() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🐧  Building for Linux...${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if ! command -v gcc &>/dev/null; then
        echo -e "${YELLOW}⚠️  gcc not found — required for CGO${NC}"
        echo "  Debian/Ubuntu: sudo apt-get install build-essential"
    fi
    if [ "$(uname -s)" = "Linux" ]; then
        if ! dpkg -l libgtk-3-dev &>/dev/null && ! rpm -q gtk3-devel &>/dev/null; then
            echo -e "${YELLOW}⚠️  GTK3 dev headers not detected${NC}"
            echo "  Debian/Ubuntu: sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev"
        fi
    fi

    echo -e "${YELLOW}→${NC} Building Linux AMD64..."
    GOOS=linux GOARCH=amd64 CGO_ENABLED=1 \
        "$GO" build -ldflags "$VERSION_LDFLAGS" \
        -o "$BUILD_DIR/adomnia-linux-amd64" .

    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$BUILD_DIR/adomnia-linux-amd64" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} adomnia-linux-amd64 ($SIZE)"
    else
        echo -e "${RED}✗${NC} Linux AMD64 build failed"
        return 1
    fi

    echo -e "${YELLOW}→${NC} Building Linux ARM64..."
    GOOS=linux GOARCH=arm64 CGO_ENABLED=1 \
        "$GO" build -ldflags "$VERSION_LDFLAGS" \
        -o "$BUILD_DIR/adomnia-linux-arm64" .

    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$BUILD_DIR/adomnia-linux-arm64" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} adomnia-linux-arm64 ($SIZE)"
    else
        echo -e "${RED}✗${NC} Linux ARM64 build failed"
        return 1
    fi
}

# Build current platform
build_current() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🔨  Building for current platform...${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    case $ARCH in
        x86_64)        GOARCH="amd64" ;;
        arm64|aarch64) GOARCH="arm64" ;;
        i386|i686)     GOARCH="386"   ;;
        *) echo -e "${RED}❌ Unsupported architecture: $ARCH${NC}"; exit 1 ;;
    esac

    # In WSL, build for Windows (the host OS)
    if _in_wsl; then OS="windows"; fi

    OUTPUT="$BUILD_DIR/adomnia-$OS-$GOARCH"
    [ "$OS" = "windows" ] && OUTPUT="$OUTPUT.exe"

    echo -e "${YELLOW}→${NC} Building for $OS/$GOARCH..."

    if [ "$OS" = "windows" ]; then
        CGO_ENABLED=1 "$GO" build -ldflags "$VERSION_LDFLAGS -H windowsgui" -o "$OUTPUT" .
    else
        CGO_ENABLED=1 "$GO" build -ldflags "$VERSION_LDFLAGS" -o "$OUTPUT" .
    fi

    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} $OUTPUT ($SIZE)"
        [ "$OS" != "windows" ] && chmod +x "$OUTPUT"
    else
        echo -e "${RED}✗${NC} Build failed"
        exit 1
    fi
}

compress_binaries() {
    if command -v upx &>/dev/null; then
        echo -e "${CYAN}📦  Compressing with UPX...${NC}"
        for binary in "$BUILD_DIR"/adomnia-*; do
            [ -f "$binary" ] && upx --best --lzma "$binary" 2>&1 | grep -E "(compressed|Ratio)" || true
        done
    fi
}

create_checksums() {
    echo ""
    echo -e "${CYAN}🔐  Generating checksums...${NC}"
    cd "$BUILD_DIR"
    if command -v sha256sum &>/dev/null; then
        sha256sum adomnia-* > SHA256SUMS.txt && echo -e "${GREEN}✓${NC} SHA256SUMS.txt"
    elif command -v shasum &>/dev/null; then
        shasum -a 256 adomnia-* > SHA256SUMS.txt && echo -e "${GREEN}✓${NC} SHA256SUMS.txt"
    else
        echo -e "${YELLOW}⚠️${NC} No SHA256 tool found"
    fi
    cd ..
}

show_summary() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅  Build Complete!${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    ls -lh "$BUILD_DIR/" | tail -n +2
    echo ""
    echo -e "  Release: ${YELLOW}gh release create v$VERSION ./dist/*${NC}"
    echo ""
}

main() {
    TARGET=${1:-"current"}

    build_frontend
    clean_build_dir

    case $TARGET in
        all)
            build_windows || echo -e "${YELLOW}⚠️  Windows skipped${NC}"
            build_macos   || echo -e "${YELLOW}⚠️  macOS skipped${NC}"
            build_linux   || echo -e "${YELLOW}⚠️  Linux skipped${NC}"
            compress_binaries
            create_checksums
            ;;
        windows)  build_windows; create_checksums ;;
        macos)    build_macos;   create_checksums ;;
        linux)    build_linux;   create_checksums ;;
        current)  build_current; create_checksums ;;
        *)
            echo -e "${RED}❌ Unknown target: $TARGET${NC}"
            echo "Usage: $0 [current|all|windows|macos|linux] [version]"
            exit 1
            ;;
    esac

    show_summary
}

main "$@"
