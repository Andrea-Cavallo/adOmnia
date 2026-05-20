#!/bin/bash
#
# build.sh - Multi-platform build script for adOmnia
#
# Run from project root:
#   ./build/build.sh              # Build current platform only
#   ./build/build.sh all          # Build all platforms
#   ./build/build.sh windows      # Build Windows only
#   ./build/build.sh macos        # Build macOS (Intel + ARM)
#   ./build/build.sh linux        # Build Linux only
#   ./build/build.sh all 1.0.0    # Build all with version number
#

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
VERSION=${2:-"dev"}
BUILD_DIR="dist"
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Build flags
BASE_LDFLAGS="-s -w"
VERSION_LDFLAGS="$BASE_LDFLAGS -X main.Version=$VERSION -X main.BuildDate=$BUILD_DATE -X main.GitCommit=$GIT_COMMIT"

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     adOmnia Build Script v$VERSION        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# Check Go installation
if ! command -v go &> /dev/null; then
    echo -e "${RED}❌ Error: Go is not installed${NC}"
    echo "Download from: https://golang.org/dl/"
    exit 1
fi

echo -e "${GREEN}✓${NC} Go version: $(go version | awk '{print $3}')"

# M6: Check Go minimum version
GO_MINOR=$(go version | awk '{print $3}' | sed 's/go1\.//')
if [ "$GO_MINOR" -lt 22 ] 2>/dev/null; then
    echo -e "${RED}❌ Go 1.22+ required. Found: $(go version | awk '{print $3}')${NC}"
    echo "  Download: https://go.dev/dl/"
    exit 1
fi

echo -e "${GREEN}✓${NC} Build version: $VERSION"
echo -e "${GREEN}✓${NC} Git commit: $GIT_COMMIT"
echo ""

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
    
    # M6: Check MinGW toolchain
    if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
        echo -e "${YELLOW}⚠️  MinGW not found — required for Windows CGO cross-compilation${NC}"
        echo "  macOS: brew install mingw-w64"
        echo "  Linux: sudo apt-get install gcc-mingw-w64-x86-64"
        echo ""
        if [ "$(uname -s)" = "Darwin" ] || [ "$(uname -s)" = "Linux" ]; then
            echo -e "${RED}❌ Cannot cross-compile Windows binary without MinGW${NC}"
            return 1
        fi
    fi
    
    echo -e "${YELLOW}→${NC} Building Windows AMD64..."
    GOOS=windows GOARCH=amd64 CGO_ENABLED=1 CC=x86_64-w64-mingw32-gcc \
        go build -ldflags "$VERSION_LDFLAGS -H windowsgui" \
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
    
    # M6: macOS build requires Darwin host or CGO cross-compilation setup
    if [ "$(uname -s)" != "Darwin" ]; then
        echo -e "${YELLOW}⚠️  Cross-compiling macOS binary from non-macOS host${NC}"
        echo "  Ensure CGO toolchain is configured (may require osxcross or similar)"
    fi
    
    echo -e "${YELLOW}→${NC} Building macOS Intel (AMD64)..."
    GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 \
        go build -ldflags "$VERSION_LDFLAGS" \
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
        go build -ldflags "$VERSION_LDFLAGS" \
        -o "$BUILD_DIR/adomnia-darwin-arm64" .
    
    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$BUILD_DIR/adomnia-darwin-arm64" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} adomnia-darwin-arm64 ($SIZE)"
    else
        echo -e "${RED}✗${NC} macOS ARM64 build failed"
        return 1
    fi
    
    # Create universal binary if both builds succeeded
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
    
    # M6: Check GCC and GTK for CGO builds
    if ! command -v gcc &> /dev/null; then
        echo -e "${YELLOW}⚠️  gcc not found — required for CGO${NC}"
        echo "  Debian/Ubuntu: sudo apt-get install build-essential"
        echo "  Fedora:        sudo dnf install gcc"
    fi
    if [ "$(uname -s)" = "Linux" ]; then
        if ! dpkg -l libgtk-3-dev &>/dev/null && ! rpm -q gtk3-devel &>/dev/null; then
            echo -e "${YELLOW}⚠️  GTK3 development headers not detected${NC}"
            echo "  Debian/Ubuntu: sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev"
            echo "  Fedora:        sudo dnf install gtk3-devel webkit2gtk3-devel"
            echo "  Arch:          sudo pacman -S gtk3 webkit2gtk"
        fi
    fi
    
    echo -e "${YELLOW}→${NC} Building Linux AMD64..."
    GOOS=linux GOARCH=amd64 CGO_ENABLED=1 \
        go build -ldflags "$VERSION_LDFLAGS" \
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
        go build -ldflags "$VERSION_LDFLAGS" \
        -o "$BUILD_DIR/adomnia-linux-arm64" .
    
    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$BUILD_DIR/adomnia-linux-arm64" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} adomnia-linux-arm64 ($SIZE)"
    else
        echo -e "${RED}✗${NC} Linux ARM64 build failed"
        return 1
    fi
}

# Build current platform only
build_current() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🔨  Building for current platform...${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case $ARCH in
        x86_64) GOARCH="amd64" ;;
        arm64|aarch64) GOARCH="arm64" ;;
        i386|i686) GOARCH="386" ;;
        *) echo -e "${RED}❌ Unsupported architecture: $ARCH${NC}"; exit 1 ;;
    esac
    
    OUTPUT="$BUILD_DIR/adomnia-$OS-$GOARCH"
    [ "$OS" = "windows" ] && OUTPUT="$OUTPUT.exe"
    
    echo -e "${YELLOW}→${NC} Building for $OS/$GOARCH..."
    
    if [ "$OS" = "windows" ]; then
        CGO_ENABLED=1 go build -ldflags "$VERSION_LDFLAGS -H windowsgui" -o "$OUTPUT" .
    else
        CGO_ENABLED=1 go build -ldflags "$VERSION_LDFLAGS" -o "$OUTPUT" .
    fi
    
    if [ $? -eq 0 ]; then
        SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} $OUTPUT ($SIZE)"
        
        # Make executable on Unix-like systems
        [ "$OS" != "windows" ] && chmod +x "$OUTPUT"
    else
        echo -e "${RED}✗${NC} Build failed"
        exit 1
    fi
}

# Compress binaries with UPX (if available)
compress_binaries() {
    if command -v upx &> /dev/null; then
        echo ""
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${CYAN}📦  Compressing binaries with UPX...${NC}"
        echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        
        for binary in "$BUILD_DIR"/adomnia-*; do
            if [ -f "$binary" ]; then
                echo -e "${YELLOW}→${NC} Compressing $(basename "$binary")..."
                upx --best --lzma "$binary" 2>&1 | grep -E "(compressed|Ratio)" || true
            fi
        done
    fi
}

# Create checksums
create_checksums() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}🔐  Generating checksums...${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    cd "$BUILD_DIR"
    
    if command -v sha256sum &> /dev/null; then
        sha256sum adomnia-* > SHA256SUMS.txt
        echo -e "${GREEN}✓${NC} SHA256SUMS.txt created"
    elif command -v shasum &> /dev/null; then
        shasum -a 256 adomnia-* > SHA256SUMS.txt
        echo -e "${GREEN}✓${NC} SHA256SUMS.txt created"
    else
        echo -e "${YELLOW}⚠️${NC}  No SHA256 tool found, skipping checksums"
    fi
    
    cd ..
}

# Summary
show_summary() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}✅  Build Complete!${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "${CYAN}Artifacts:${NC}"
    ls -lh "$BUILD_DIR/" | tail -n +2
    echo ""
    echo -e "${CYAN}Next steps:${NC}"
    echo -e "  • Test binaries on target platforms"
    echo -e "  • Create GitHub release: ${YELLOW}gh release create v$VERSION ./dist/*${NC}"
    echo -e "  • Update CHANGELOG.md"
    echo ""
}

# Main execution
main() {
    TARGET=${1:-"current"}
    
    clean_build_dir
    
    case $TARGET in
        all)
            build_windows || echo -e "${YELLOW}⚠️  Windows build skipped${NC}"
            build_macos || echo -e "${YELLOW}⚠️  macOS build skipped${NC}"
            build_linux || echo -e "${YELLOW}⚠️  Linux build skipped${NC}"
            compress_binaries
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
            build_current
            create_checksums
            ;;
        *)
            echo -e "${RED}❌ Unknown target: $TARGET${NC}"
            echo ""
            echo "Usage: $0 [target] [version]"
            echo ""
            echo "Targets:"
            echo "  current   Build for current platform (default)"
            echo "  all       Build for all platforms"
            echo "  windows   Build Windows binaries"
            echo "  macos     Build macOS binaries"
            echo "  linux     Build Linux binaries"
            echo ""
            echo "Example: $0 all 1.0.0"
            exit 1
            ;;
    esac
    
    show_summary
}

# Run
main "$@"
