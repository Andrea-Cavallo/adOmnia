#!/usr/bin/env bash
#
# build.sh -- adOmnia build script (Bash)
#
# Uses Wails for production builds so the executable keeps app icon,
# manifest and platform metadata. On Windows shells (WSL/Git Bash/MSYS), it
# delegates to build.ps1 to use the native Windows Wails toolchain.
#
# Usage:
#   ./build.sh              # Build for current platform
#   ./build.sh clean        # Clean build artifacts
#
set -euo pipefail

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

VERSION="${VERSION:-dev}"
UNAME="$(uname -s 2>/dev/null || echo unknown)"

is_windows_shell() {
  [[ -n "${WSL_DISTRO_NAME:-}" ]] && return 0
  [[ "$UNAME" == MINGW* || "$UNAME" == MSYS* || "$UNAME" == CYGWIN* ]] && return 0
  return 1
}

to_windows_path() {
  local path="$1"
  if command -v wslpath &>/dev/null; then
    wslpath -w "$path"
  elif command -v cygpath &>/dev/null; then
    cygpath -w "$path"
  else
    printf '%s\n' "$path"
  fi
}

abs_output_path() {
  local output="$1"
  if [[ "$output" = /* || "$output" =~ ^[A-Za-z]:[\\/] ]]; then
    printf '%s\n' "$output"
  else
    printf '%s/%s\n' "$SCRIPT_DIR" "$output"
  fi
}

if [[ "${1:-}" == "clean" ]]; then
  info "Cleaning build artifacts..."
  rm -f "$SCRIPT_DIR/adomnia.exe" "$SCRIPT_DIR/adomnia"
  rm -rf "$SCRIPT_DIR/build/bin" "$SCRIPT_DIR/frontend/dist"
  ok "Clean complete."
  exit 0
fi

echo ""
echo -e "${CYAN}===========================================${NC}"
echo -e "${CYAN}  adOmnia Wails Build  v${VERSION}${NC}"
echo -e "${CYAN}===========================================${NC}"
echo ""

if is_windows_shell && command -v powershell.exe &>/dev/null; then
  OUTPUT="${OUTPUT:-adomnia.exe}"
  OUTPUT_ABS="$(abs_output_path "$OUTPUT")"
  PS_SCRIPT="$(to_windows_path "$SCRIPT_DIR/build.ps1")"
  PS_OUTPUT="$(to_windows_path "$OUTPUT_ABS")"

  info "Windows shell detected; delegating to native PowerShell/Wails build."
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PS_SCRIPT" -Output "$PS_OUTPUT" -Version "$VERSION"
  exit $?
fi

OUTPUT="${OUTPUT:-adomnia}"
FRONTEND_DIR="$SCRIPT_DIR/frontend"
WAILS_OUT_DIR="$SCRIPT_DIR/build/bin"
OUTNAME="$(basename "$OUTPUT")"
WAILS_OUT="$WAILS_OUT_DIR/$OUTNAME"

if ! command -v node &>/dev/null; then
  err "Node.js not found. Install from https://nodejs.org/"
  exit 1
fi
ok "Node.js: $(node --version)"

if ! command -v npm &>/dev/null; then
  err "npm not found. Install Node.js from https://nodejs.org/"
  exit 1
fi
ok "npm: $(npm --version)"

if ! command -v go &>/dev/null; then
  err "Go not found. Install from https://go.dev/dl/"
  exit 1
fi
ok "Go: $(go version | awk '{print $3}')"

WAILS_BIN=""
if command -v wails &>/dev/null; then
  WAILS_BIN="$(command -v wails)"
else
  GOPATH="$(go env GOPATH 2>/dev/null || true)"
  if [[ -n "$GOPATH" && -x "$GOPATH/bin/wails" ]]; then
    WAILS_BIN="$GOPATH/bin/wails"
  fi
fi

if [[ -z "$WAILS_BIN" ]]; then
  err "Wails CLI not found. Install it with:"
  echo "    go install github.com/wailsapp/wails/v2/cmd/wails@latest"
  exit 1
fi
ok "Wails: $("$WAILS_BIN" version 2>/dev/null | head -1 || echo ok)"

echo ""

if [[ -f "$SCRIPT_DIR/scripts/generate-icons.sh" ]]; then
  info "Preparing app icons..."
  bash "$SCRIPT_DIR/scripts/generate-icons.sh"
fi

if [[ ! -f "$SCRIPT_DIR/build/appicon.png" ]]; then
  err "Wails app icon missing at build/appicon.png"
  exit 1
fi

GIT_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_DATE="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
LDFLAGS="-s -w -X main.Version=$VERSION -X main.BuildDate=$BUILD_DATE -X main.GitCommit=$GIT_COMMIT"

echo ""
echo -e "${CYAN}--- Building with Wails...${NC}"
info "Version:  $VERSION"
info "Commit:   $GIT_COMMIT"
info "Output:   $OUTPUT"
echo ""

"$WAILS_BIN" build -clean -ldflags "$LDFLAGS" -o "$OUTNAME"

if [[ ! -f "$WAILS_OUT" ]]; then
  err "Expected Wails output not found: $WAILS_OUT"
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT")"
cp "$WAILS_OUT" "$OUTPUT"
chmod +x "$OUTPUT" 2>/dev/null || true

SIZE="$(ls -lh "$OUTPUT" | awk '{print $5}')"

echo ""
echo -e "${GREEN}===========================================${NC}"
echo -e "${GREEN}  Build Complete!${NC}"
echo -e "${GREEN}===========================================${NC}"
echo ""
echo -e "  ${CYAN}$OUTPUT${NC}  (${SIZE})"
echo ""
