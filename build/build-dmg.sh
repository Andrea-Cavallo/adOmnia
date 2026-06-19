#!/bin/bash
#
# build-dmg.sh - Create macOS .dmg for adOmnia
#
# Run from project root on macOS:
#   ./build/build-dmg.sh              # Build DMG with dev version
#   ./build/build-dmg.sh 1.0.0        # Build DMG with version number
#
# Requirements:
#   - macOS with Xcode Command Line Tools
#   - create-dmg (brew install create-dmg)
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

VERSION=${1:-"dev"}
APP_NAME="adomnia"
BUILD_DIR="dist"
DMG_DIR="$BUILD_DIR/dmg"
APP_BUNDLE="$DMG_DIR/$APP_NAME.app"
ICON_SRC="assets/images/icon.png"
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

LDFLAGS="-s -w -X main.Version=$VERSION -X main.BuildDate=$BUILD_DATE -X main.GitCommit=$GIT_COMMIT"

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║    adOmnia macOS DMG Builder v$VERSION   ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# Check macOS
if [[ "$(uname -s)" != "Darwin" ]]; then
    echo -e "${RED}❌ This script must run on macOS${NC}"
    exit 1
fi

# Check create-dmg
if ! command -v create-dmg &> /dev/null; then
    echo -e "${YELLOW}⚠️  create-dmg not found. Installing...${NC}"
    brew install create-dmg
fi

# Clean
echo -e "${YELLOW}🗑️  Cleaning previous builds...${NC}"
rm -rf "$DMG_DIR"
mkdir -p "$DMG_DIR"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

# Build universal binary
echo -e "${CYAN}🔨  Building universal binary...${NC}"

echo -e "${YELLOW}→${NC} Building for Intel (AMD64)..."
GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -ldflags "$LDFLAGS" -o "$DMG_DIR/adomnia-amd64" .

echo -e "${YELLOW}→${NC} Building for Apple Silicon (ARM64)..."
GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -ldflags "$LDFLAGS" -o "$DMG_DIR/adomnia-arm64" .

echo -e "${YELLOW}→${NC} Creating universal binary..."
lipo -create -output "$APP_BUNDLE/Contents/MacOS/$APP_NAME" \
    "$DMG_DIR/adomnia-amd64" \
    "$DMG_DIR/adomnia-arm64"

chmod +x "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
rm "$DMG_DIR/adomnia-amd64" "$DMG_DIR/adomnia-arm64"

UNIVERSAL_SIZE=$(ls -lh "$APP_BUNDLE/Contents/MacOS/$APP_NAME" | awk '{print $5}')
echo -e "${GREEN}✓${NC} Universal binary created ($UNIVERSAL_SIZE)"

# Create Info.plist
echo -e "${CYAN}📄  Creating Info.plist...${NC}"
cat > "$APP_BUNDLE/Contents/Info.plist" << 'PLISTEOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>adomnia</string>
    <key>CFBundleIdentifier</key>
    <string>com.andreacavallo.adomnia</string>
    <key>CFBundleName</key>
    <string>adomnia</string>
    <key>CFBundleDisplayName</key>
    <string>adomnia</string>
    <key>CFBundleVersion</key>
    <string>VERSION_PLACEHOLDER</string>
    <key>CFBundleShortVersionString</key>
    <string>VERSION_PLACEHOLDER</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleSignature</key>
    <string>????</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>10.15</string>
    <key>NSHumanReadableCopyright</key>
    <string>© 2026 Andrea Cavallo. All rights reserved.</string>
    <key>CFBundleIconFile</key>
    <string>icon</string>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key>
        <true/>
    </dict>
</dict>
</plist>
PLISTEOF

# Replace version placeholder
sed -i '' "s/VERSION_PLACEHOLDER/$VERSION/g" "$APP_BUNDLE/Contents/Info.plist"

# Convert icon for macOS (.icns)
echo -e "${CYAN}🖼️   Creating macOS icon...${NC}"
if [ -f "$ICON_SRC" ]; then
    # Create temporary iconset
    ICONSET="$DMG_DIR/icon.iconset"
    mkdir -p "$ICONSET"
    
    # Use sips to resize for various sizes
    for size in 16 32 64 128 256 512; do
        half=$((size / 2))
        sips -z $size $size "$ICON_SRC" --out "$ICONSET/icon_${size}x${size}.png" &>/dev/null || true
        sips -z $size $size "$ICON_SRC" --out "$ICONSET/icon_${half}x${half}@2x.png" &>/dev/null || true
    done
    
    # Create .icns from iconset
    iconutil -c icns "$ICONSET" -o "$APP_BUNDLE/Contents/Resources/icon.icns" 2>/dev/null || {
        echo -e "${YELLOW}⚠️  Could not create .icns, skipping icon${NC}"
    }
    rm -rf "$ICONSET"
else
    echo -e "${YELLOW}⚠️  No icon source found at $ICON_SRC${NC}"
fi

# Create DMG
echo -e "${CYAN}📦  Creating DMG...${NC}"
DMG_NAME="$APP_NAME-$VERSION.dmg"
DMG_PATH="$BUILD_DIR/$DMG_NAME"

create-dmg \
    --volname "$APP_NAME v$VERSION" \
    --volicon "$APP_BUNDLE/Contents/Resources/icon.icns" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon-size 100 \
    --icon "$APP_NAME.app" 150 190 \
    --hide-extension "$APP_NAME.app" \
    --app-drop-link 400 190 \
    "$DMG_PATH" \
    "$DMG_DIR" \
    2>/dev/null || {
        # Fallback: use hdiutil directly
        echo -e "${YELLOW}⚠️  create-dmg failed, using hdiutil...${NC}"
        hdiutil create -volname "$APP_NAME v$VERSION" -srcfolder "$DMG_DIR" -ov -format UDZO "$DMG_PATH"
    }

if [ -f "$DMG_PATH" ]; then
    DMG_SIZE=$(ls -lh "$DMG_PATH" | awk '{print $5}')
    echo -e "${GREEN}✓${NC} $DMG_NAME created ($DMG_SIZE)"
else
    echo -e "${RED}✗${NC} DMG creation failed"
    exit 1
fi

# Cleanup
rm -rf "$DMG_DIR"

# ── Code signing ───────────────────────────────────────────────────────────────
# Set APPLE_SIGN_IDENTITY env var to enable:
#   export APPLE_SIGN_IDENTITY="Developer ID Application: Andrea Cavallo (TEAMID)"
#   export APPLE_NOTARIZE=1   # optional: also notarize after signing
if [ -n "$APPLE_SIGN_IDENTITY" ]; then
    echo -e "${CYAN}✍️   Signing DMG...${NC}"
    codesign \
        --sign "$APPLE_SIGN_IDENTITY" \
        --timestamp \
        --options runtime \
        "$DMG_PATH"
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} DMG signed: $APPLE_SIGN_IDENTITY"
    else
        echo -e "${YELLOW}⚠️  Signing failed (continuing)${NC}"
    fi

    if [ "${APPLE_NOTARIZE:-0}" = "1" ] && [ -n "$APPLE_NOTARIZE_PROFILE" ]; then
        echo -e "${CYAN}☁️   Notarizing DMG (this may take a few minutes)...${NC}"
        xcrun notarytool submit "$DMG_PATH" \
            --keychain-profile "$APPLE_NOTARIZE_PROFILE" \
            --wait
        xcrun stapler staple "$DMG_PATH"
        echo -e "${GREEN}✓${NC} Notarization complete"
    fi
else
    echo -e "${YELLOW}ℹ️   No signing — set APPLE_SIGN_IDENTITY to sign the DMG${NC}"
    echo -e "   export APPLE_SIGN_IDENTITY=\"Developer ID Application: Andrea Cavallo (TEAMID)\""
fi

echo ""
echo -e "${GREEN}✅  DMG ready: $DMG_PATH${NC}"
