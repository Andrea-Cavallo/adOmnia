#!/bin/bash
#
# build-linux.sh - Build portable Linux binary / AppImage for adOmnia
#
# Run from project root:
#   ./build/build-linux.sh              # Build portable binary for host arch
#   ./build/build-linux.sh 1.0.0        # Build with version number
#   ./build/build-linux.sh 1.0.0 all    # Build all Linux architectures
#
# Requirements:
#   - Go 1.22+
#   - For AppImage: appimagetool (optional)
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

VERSION=${1:-"dev"}
TARGET=${2:-"current"}
APP_NAME="adomnia"
BUILD_DIR="dist/linux"
LINUX_DESKTOP_FILE="build/linux/adOmnia.desktop"
# ICON SOURCE — single source of truth for all Linux icons
ICON_SRC_PNG="assets/images/icon.png"
ICON_256="assets/icons/linux/adOmnia_256x256.png"
REQUIRED_ICONS=(
    "build/appicon.png"
    "assets/icons/linux/adOmnia_16x16.png"
    "assets/icons/linux/adOmnia_24x24.png"
    "assets/icons/linux/adOmnia_32x32.png"
    "assets/icons/linux/adOmnia_48x48.png"
    "assets/icons/linux/adOmnia_64x64.png"
    "assets/icons/linux/adOmnia_128x128.png"
    "assets/icons/linux/adOmnia_256x256.png"
    "assets/icons/linux/adOmnia_512x512.png"
)
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

LDFLAGS="-s -w -X main.Version=$VERSION -X main.BuildDate=$BUILD_DATE -X main.GitCommit=$GIT_COMMIT"

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   adOmnia Linux Builder v$VERSION        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# ── Icon generation ────────────────────────────────────────────────────────────
ICONS_MISSING=false
for icon in "${REQUIRED_ICONS[@]}"; do
    if [ ! -f "$icon" ]; then
        ICONS_MISSING=true
        break
    fi
done

if [ "$ICONS_MISSING" = true ] && [ -f "scripts/generate-icons.sh" ]; then
    echo -e "${CYAN}🎨  Generating missing icons...${NC}"
    bash scripts/generate-icons.sh
    echo ""
elif [ "$ICONS_MISSING" = true ]; then
    echo -e "${YELLOW}⚠️  scripts/generate-icons.sh not found and one or more icon assets are missing${NC}"
    echo -e "    Run: bash scripts/generate-icons.sh"
else
    echo -e "${GREEN}✓${NC} Icon assets already present"
    echo ""
fi

# Check Go
if ! command -v go &> /dev/null; then
    echo -e "${RED}❌ Go is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Go: $(go version | awk '{print $3}')"
echo -e "${GREEN}✓${NC} Version: $VERSION"
echo ""

if ! command -v npm &> /dev/null; then
    echo -e "${RED}❌ npm is not installed${NC}"
    exit 1
fi

if ! command -v wails &> /dev/null; then
    echo -e "${YELLOW}⚠️  Wails CLI not found in PATH, checking GOPATH/bin...${NC}"
    WAILS_BIN="$(go env GOPATH)/bin/wails"
    if [ ! -x "$WAILS_BIN" ]; then
        echo -e "${RED}❌ Wails is not installed${NC}"
        echo -e "    Run: go install github.com/wailsapp/wails/v2/cmd/wails@latest"
        exit 1
    fi
else
    WAILS_BIN="wails"
fi
echo -e "${GREEN}✓${NC} Wails: $($WAILS_BIN version 2>/dev/null | head -1)"
echo ""

# Clean
echo -e "${YELLOW}🗑️  Cleaning previous builds...${NC}"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

build_arch() {
    local GOARCH=$1
    local OUTPUT="$BUILD_DIR/$APP_NAME-linux-$GOARCH"
    local OUTNAME="$APP_NAME-linux-$GOARCH"
    local BUILT_OUTPUT="build/bin/$OUTNAME"
    local TAGS
    local TAG_ARGS=()

    TAGS="$(detect_linux_webkit_tags)"
    if [ -n "$TAGS" ]; then
        TAG_ARGS=(-tags "$TAGS")
        echo -e "${GREEN}✓${NC} WebKitGTK 4.1 detected; using Go build tags: $TAGS"
    fi
    
    echo -e "${YELLOW}→${NC} Building Linux $GOARCH..."
    "$WAILS_BIN" build \
        -platform "linux/$GOARCH" \
        "${TAG_ARGS[@]}" \
        -ldflags "$LDFLAGS" \
        -o "$OUTNAME"
    
    if [ -f "$BUILT_OUTPUT" ]; then
        cp "$BUILT_OUTPUT" "$OUTPUT"
        chmod +x "$OUTPUT"
        SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} $APP_NAME-linux-$GOARCH ($SIZE)"
    else
        echo -e "${RED}✗${NC} Linux $GOARCH build failed"
        return 1
    fi
}

build_arch_static() {
    local GOARCH=$1
    echo -e "${YELLOW}⚠️  Static Linux build skipped for $GOARCH: Wails/WebKitGTK requires CGO${NC}"
}

detect_linux_webkit_tags() {
    if command -v pkg-config &> /dev/null &&
        pkg-config --exists webkit2gtk-4.1 &&
        ! pkg-config --exists webkit2gtk-4.0; then
        echo "webkit2_41"
    fi
}

create_appimage() {
    local GOARCH=$1
    local BINARY="$BUILD_DIR/$APP_NAME-linux-$GOARCH"
    
    if [ ! -f "$BINARY" ]; then
        echo -e "${YELLOW}⚠️  Binary not found, skipping AppImage${NC}"
        return
    fi
    
    if ! command -v appimagetool &> /dev/null; then
        echo -e "${YELLOW}⚠️  appimagetool not found, skipping AppImage${NC}"
        echo -e "   Install: wget https://github.com/AppImage/AppImageKit/releases/latest/download/appimagetool-x86_64.AppImage"
        echo -e "   chmod +x appimagetool-x86_64.AppImage"
        echo -e "   sudo mv appimagetool-x86_64.AppImage /usr/local/bin/appimagetool"
        return
    fi
    
    echo -e "${CYAN}📦  Creating AppImage for $GOARCH...${NC}"
    
    local APPDIR="$BUILD_DIR/AppDir-$GOARCH"
    mkdir -p "$APPDIR/usr/bin"
    mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
    mkdir -p "$APPDIR/usr/share/applications"
    
    # Copy binary
    cp "$BINARY" "$APPDIR/usr/bin/$APP_NAME"
    chmod +x "$APPDIR/usr/bin/$APP_NAME"
    
    # Copy icon (use generated 256x256 PNG)
    ICON_FOR_APPIMAGE="${ICON_256:-$ICON_SRC_PNG}"
    if [ -f "$ICON_FOR_APPIMAGE" ]; then
        cp "$ICON_FOR_APPIMAGE" "$APPDIR/usr/share/icons/hicolor/256x256/apps/$APP_NAME.png"
        cp "$ICON_FOR_APPIMAGE" "$APPDIR/$APP_NAME.png"
    else
        echo -e "${YELLOW}⚠️  No PNG icon found for AppImage — run scripts/generate-icons.sh first${NC}"
    fi
    
    # Copy desktop metadata. Keep the AppImage entry relocatable.
    if [ -f "$LINUX_DESKTOP_FILE" ]; then
        sed \
            -e "s|^Exec=.*|Exec=$APP_NAME|" \
            -e "s|^Icon=.*|Icon=$APP_NAME|" \
            "$LINUX_DESKTOP_FILE" > "$APPDIR/usr/share/applications/$APP_NAME.desktop"
    else
        echo -e "${RED}❌ Missing Linux desktop entry: $LINUX_DESKTOP_FILE${NC}"
        return 1
    fi
    
    # Create symlink for AppImage
    ln -sf usr/share/applications/$APP_NAME.desktop "$APPDIR/$APP_NAME.desktop" 2>/dev/null || true
    ln -sf usr/share/icons/hicolor/256x256/apps/$APP_NAME.png "$APPDIR/$APP_NAME.png" 2>/dev/null || true
    ln -sf usr/bin/$APP_NAME "$APPDIR/AppRun" 2>/dev/null || true
    
    # Create AppImage
    APPIMAGE="$BUILD_DIR/$APP_NAME-$VERSION-linux-$GOARCH.AppImage"
    ARCH=$GOARCH appimagetool "$APPDIR" "$APPIMAGE" 2>/dev/null
    
    if [ -f "$APPIMAGE" ]; then
        chmod +x "$APPIMAGE"
        SIZE=$(ls -lh "$APPIMAGE" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} AppImage created ($SIZE)"
    fi
    
    rm -rf "$APPDIR"
}

create_portable_archive() {
    local GOARCH=$1
    local BINARY="$BUILD_DIR/$APP_NAME-linux-$GOARCH"
    
    if [ ! -f "$BINARY" ]; then
        return
    fi
    
    echo -e "${CYAN}📦  Creating portable archive for $GOARCH...${NC}"
    
    local ARCHIVE_DIR="$BUILD_DIR/$APP_NAME-$VERSION-linux-$GOARCH"
    mkdir -p "$ARCHIVE_DIR"
    
    cp "$BINARY" "$ARCHIVE_DIR/$APP_NAME"
    chmod +x "$ARCHIVE_DIR/$APP_NAME"
    
    # Copy icon
    ICON_FOR_ARCHIVE="${ICON_256:-$ICON_SRC_PNG}"
    if [ -f "$ICON_FOR_ARCHIVE" ]; then
        cp "$ICON_FOR_ARCHIVE" "$ARCHIVE_DIR/icon.png"
    fi
    
    if [ -f "$LINUX_DESKTOP_FILE" ]; then
        cp "$LINUX_DESKTOP_FILE" "$ARCHIVE_DIR/adomnia.desktop"
    else
        echo -e "${RED}❌ Missing Linux desktop entry: $LINUX_DESKTOP_FILE${NC}"
        return 1
    fi

    # Include installer metadata used by desktop launchers.
    mkdir -p "$ARCHIVE_DIR/icons"
    for size in 16 24 32 48 64 128 256 512; do
        local icon="assets/icons/linux/adOmnia_${size}x${size}.png"
        if [ -f "$icon" ]; then
            cp "$icon" "$ARCHIVE_DIR/icons/"
        fi
    done
    if [ -f build/linux/install.sh ]; then
        cp build/linux/install.sh "$ARCHIVE_DIR/install.sh"
        chmod +x "$ARCHIVE_DIR/install.sh"
    fi
    if [ -f build/linux/uninstall.sh ]; then
        cp build/linux/uninstall.sh "$ARCHIVE_DIR/uninstall.sh"
        chmod +x "$ARCHIVE_DIR/uninstall.sh"
    fi

    # Create README
    cat > "$ARCHIVE_DIR/README.txt" << EOF
adOmnia v$VERSION - Linux ($GOARCH)
====================================

Developer Toolbox — API client, WebSocket, mock server, and more.
Sviluppato da Andrea Cavallo.

Requirements: GTK3 + WebKitGTK (for WebView)

Ubuntu/Debian: sudo apt-get install libgtk-3-0 libwebkit2gtk-4.0-37
Fedora:        sudo dnf install gtk3 webkit2gtk3
Arch:          sudo pacman -S gtk3 webkit2gtk

Run: ./adomnia
Install desktop launcher: sudo ./install.sh

All data is stored locally. No cloud, no account required.
EOF
    
    cd "$BUILD_DIR"
    tar -czf "$APP_NAME-$VERSION-linux-$GOARCH.tar.gz" "$(basename "$ARCHIVE_DIR")"
    cd - > /dev/null
    
    if [ -f "$BUILD_DIR/$APP_NAME-$VERSION-linux-$GOARCH.tar.gz" ]; then
        SIZE=$(ls -lh "$BUILD_DIR/$APP_NAME-$VERSION-linux-$GOARCH.tar.gz" | awk '{print $5}')
        echo -e "${GREEN}✓${NC} Portable archive created ($SIZE)"
    fi
    
    rm -rf "$ARCHIVE_DIR"
}

# Build based on target
case $TARGET in
    amd64)
        build_arch "amd64"
        build_arch_static "amd64"
        create_portable_archive "amd64"
        ;;
    arm64)
        build_arch "arm64"
        build_arch_static "arm64"
        create_portable_archive "arm64"
        ;;
    all)
        build_arch "amd64"
        build_arch_static "amd64"
        create_portable_archive "amd64"
        create_appimage "amd64"
        
        build_arch "arm64"
        build_arch_static "arm64"
        create_portable_archive "arm64"
        create_appimage "arm64"
        ;;
    current)
        ARCH=$(uname -m)
        case $ARCH in
            x86_64)  GOARCH="amd64" ;;
            aarch64) GOARCH="arm64" ;;
            arm64)   GOARCH="arm64" ;;
            *)       GOARCH="amd64" ;;
        esac
        build_arch "$GOARCH"
        create_portable_archive "$GOARCH"
        create_appimage "$GOARCH"
        ;;
    *)
        echo -e "${RED}❌ Unknown target: $TARGET${NC}"
        echo ""
        echo "Usage: $0 [version] [target]"
        echo ""
        echo "Targets: current, all, amd64, arm64"
        echo ""
        echo "Examples:"
        echo "  $0 1.0.0 current    Build for current arch"
        echo "  $0 1.0.0 all        Build for all Linux archs"
        echo "  $0 1.0.0 amd64      Build for AMD64 only"
        exit 1
        ;;
esac

# Create checksums
echo ""
echo -e "${CYAN}🔐  Generating checksums...${NC}"
cd "$BUILD_DIR"
sha256sum adomnia-* > SHA256SUMS.txt 2>/dev/null || \
    sha256sum adOmnia-* > SHA256SUMS.txt 2>/dev/null || \
    shasum -a 256 adomnia-* > SHA256SUMS.txt 2>/dev/null || \
    shasum -a 256 adOmnia-* > SHA256SUMS.txt 2>/dev/null || \
    echo -e "${YELLOW}⚠️  Could not generate checksums${NC}"
cd - > /dev/null
echo -e "${GREEN}✓${NC} SHA256SUMS.txt created"

# Summary
echo ""
echo -e "${GREEN}✅  Linux build complete!${NC}"
echo ""
echo -e "${CYAN}Artifacts:${NC}"
ls -lh "$BUILD_DIR/" | tail -n +2
echo ""
echo -e "${CYAN}Portable usage:${NC}"
echo -e "  1. Extract: ${YELLOW}tar xzf adomnia-$VERSION-linux-amd64.tar.gz${NC}"
echo -e "  2. Install deps: ${YELLOW}sudo apt-get install libgtk-3-0 libwebkit2gtk-4.0-37${NC}"
echo -e "  3. Run: ${YELLOW}./adomnia-$VERSION-linux-amd64/adomnia${NC}"
echo ""
