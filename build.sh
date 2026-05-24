#!/usr/bin/env bash
#
# build.sh -- adOmnia build script (Bash)
#
# Works on: Linux, macOS, Windows (Git Bash / WSL)
#
# Usage:
#   ./build.sh              # Build for current platform
#   ./build.sh clean        # Clean build artifacts
#
# The script auto-detects its location -- you can run it from anywhere.

set -euo pipefail

# -- Auto-detect project root (the directory this script lives in) -------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}-->${NC} $*"; }
ok()    { echo -e "${GREEN}OK ${NC} $*"; }
warn()  { echo -e "${YELLOW}WARN${NC} $*"; }
err()   { echo -e "${RED}ERR${NC} $*"; }

OUTPUT="${OUTPUT:-adOmnia.exe}"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# -- Clean mode ----------------------------------------------------------------
if [[ "${1:-}" == "clean" ]]; then
    info "Cleaning build artifacts..."
    rm -f  "$SCRIPT_DIR/adOmnia.exe"
    rm -rf "$FRONTEND_DIR/dist"
    rm -rf "$FRONTEND_DIR/node_modules"
    ok "Clean complete."
    exit 0
fi

echo ""
echo -e "${CYAN}===========================================${NC}"
echo -e "${CYAN}  adOmnia Build Script${NC}"
echo -e "${CYAN}===========================================${NC}"
echo ""

# -- Check prerequisites -------------------------------------------------------

# Node.js — prefer Windows-native when running under WSL
NODE=""
NPM=""
if [[ -x "/mnt/c/Program Files/nodejs/node.exe" ]]; then
    NODE="/mnt/c/Program Files/nodejs/node.exe"
    NPM="/mnt/c/Program Files/nodejs/npm.cmd"
elif command -v node.exe &>/dev/null; then
    NODE="node.exe"
    NPM="npm.cmd"
elif command -v node &>/dev/null; then
    NODE="node"
    NPM="npm"
else
    err "Node.js not found. Install from https://nodejs.org/"
    exit 1
fi
ok "Node.js: $("$NODE" --version 2>/dev/null || echo unknown)"

# Go — prefer Windows-native Go when running under WSL (WSL Go is often outdated)
GO=""
if [[ -x "/mnt/c/Program Files/Go/bin/go.exe" ]]; then
    GO="/mnt/c/Program Files/Go/bin/go.exe"
elif [[ -x "/mnt/c/Go/bin/go.exe" ]]; then
    GO="/mnt/c/Go/bin/go.exe"
elif command -v go.exe &>/dev/null; then
    GO="go.exe"
elif command -v go &>/dev/null; then
    GO="go"
else
    err "Go not found. Install from https://go.dev/dl/"
    exit 1
fi
GO_VER=$("$GO" version 2>/dev/null | awk '{print $3}' || echo "unknown")
ok "Go: $GO_VER"

GO_MINOR=$(echo "$GO_VER" | sed 's/go1\.//' | cut -d. -f1)
if [[ "$GO_MINOR" -lt 22 ]] 2>/dev/null; then
    err "Go 1.22+ required, found $GO_VER"
    if [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
        warn "You are in WSL with an old Go. Use ./build.ps1 from PowerShell instead."
    fi
    exit 1
fi

echo ""

# -- Build frontend ------------------------------------------------------------
echo -e "${CYAN}--- Building frontend...${NC}"

cd "$FRONTEND_DIR"

if [[ ! -d "node_modules" ]]; then
    info "Installing frontend dependencies..."
    "$NPM" install --silent
fi

info "Running npm run build..."
"$NPM" run build

if [[ ! -d "dist" ]]; then
    err "Frontend build failed -- dist/ directory not found."
    exit 1
fi
ok "Frontend built."

cd "$SCRIPT_DIR"

# -- Build Go binary -----------------------------------------------------------
echo ""
echo -e "${CYAN}--- Building Go binary...${NC}"

GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ" 2>/dev/null || date -u +"%Y-%m-%dT%H:%M:%SZ")
VERSION="${VERSION:-dev}"

LDFLAGS="-s -w"
LDFLAGS="$LDFLAGS -X main.Version=$VERSION"
LDFLAGS="$LDFLAGS -X main.BuildDate=$BUILD_DATE"
LDFLAGS="$LDFLAGS -X main.GitCommit=$GIT_COMMIT"

info "Version:  $VERSION"
info "Commit:   $GIT_COMMIT"
info "Output:   $OUTPUT"
echo ""

# Windows GUI flag (suppress console window)
if [[ "$OUTPUT" == *.exe ]]; then
    LDFLAGS="$LDFLAGS -H windowsgui"
fi

CGO_ENABLED=1 "$GO" build -ldflags "$LDFLAGS" -o "$OUTPUT" .

if [[ ! -f "$OUTPUT" ]]; then
    err "Go build failed -- $OUTPUT not found."
    exit 1
fi

SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
ok "Binary: $OUTPUT ($SIZE)"

# -- Done ----------------------------------------------------------------------
echo ""
echo -e "${GREEN}===========================================${NC}"
echo -e "${GREEN}  Build Complete!${NC}"
echo -e "${GREEN}===========================================${NC}"
echo ""
echo -e "  ${CYAN}$OUTPUT${NC}  (${SIZE})"
echo ""
