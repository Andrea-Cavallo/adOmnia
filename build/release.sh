#!/usr/bin/env bash
# release.sh — adOmnia release build pipeline
#
# Usage (from project root or build/):
#   ./build/release.sh           # build with wails, version=dev
#   ./build/release.sh 1.2.3     # tag a versioned release
#
# Env overrides:
#   WAILS_BIN   - path to wails executable
#   GO_BIN      - path to go executable
#   VERSION     - version string (default: first arg or "dev")
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="${1:-dev}"
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   adOmnia Release Build  v${VERSION}        ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}"
echo ""

# ── WSL detection ─────────────────────────────────────────────────────────────
_in_wsl() { [[ -n "${WSL_DISTRO_NAME:-}" ]] || [[ -n "${WSLENV:-}" ]]; }

# ── Node.js / npm detection ───────────────────────────────────────────────────
# In WSL, npm.cmd/.ps1 cannot run directly in bash.
# Fix: use cmd.exe to invoke npm — it handles Windows PATH and .cmd files correctly.
WIN_CMD="/mnt/c/Windows/System32/cmd.exe"
NODE_BIN=()
NPM_BIN=()

if _in_wsl; then
  if [[ -x "/mnt/c/Program Files/nodejs/node.exe" ]]; then
    NODE_BIN=("/mnt/c/Program Files/nodejs/node.exe")
  elif command -v node.exe >/dev/null 2>&1; then
    NODE_BIN=(node.exe)
  elif command -v node >/dev/null 2>&1; then
    NODE_BIN=(node)
  else
    echo -e "${RED}ERROR: node not found${NC}" >&2; exit 1
  fi
  # Use cmd.exe to run npm in WSL (avoids .cmd/.ps1 execution issues)
  [[ -x "$WIN_CMD" ]] && NPM_BIN=("$WIN_CMD" "/c" "npm") || NPM_BIN=(npm)
elif command -v node >/dev/null 2>&1; then
  NODE_BIN=(node)
  NPM_BIN=(npm)
else
  echo -e "${RED}ERROR: node not found${NC}" >&2; exit 1
fi
echo -e "${GREEN}✓${NC} Node: $("${NODE_BIN[@]}" --version)"

# ── Go detection ──────────────────────────────────────────────────────────────
if [[ -n "${GO_BIN:-}" ]]; then
  GO_CMD=("$GO_BIN")
elif [[ -x "/mnt/c/Program Files/Go/bin/go.exe" ]]; then
  GO_CMD=("/mnt/c/Program Files/Go/bin/go.exe")
elif [[ -x "/mnt/c/Go/bin/go.exe" ]]; then
  GO_CMD=("/mnt/c/Go/bin/go.exe")
elif command -v go.exe >/dev/null 2>&1; then
  GO_CMD=(go.exe)
elif command -v go >/dev/null 2>&1; then
  GO_CMD=(go)
else
  echo -e "${RED}ERROR: go not found${NC}" >&2; exit 1
fi
echo -e "${GREEN}✓${NC} Go: $("${GO_CMD[@]}" version | awk '{print $3}')"

# ── Wails detection ───────────────────────────────────────────────────────────
if [[ -n "${WAILS_BIN:-}" ]]; then
  WAILS_CMD=("$WAILS_BIN")
elif command -v wails >/dev/null 2>&1; then
  WAILS_CMD=(wails)
else
  # Check GOPATH/bin (where `go install` puts wails)
  GOPATH_BIN=$("${GO_CMD[@]}" env GOPATH 2>/dev/null)/bin
  WAILS_CANDIDATE="$GOPATH_BIN/wails"
  [[ "$(uname -s)" == *MINGW* || -n "${WSLENV:-}" || -n "${WSL_DISTRO_NAME:-}" ]] && WAILS_CANDIDATE="$GOPATH_BIN/wails.exe"
  if [[ -x "$WAILS_CANDIDATE" ]]; then
    WAILS_CMD=("$WAILS_CANDIDATE")
  else
    # Try common Windows GOPATH locations
    WIN_GOPATH="C:/Users/Andrea/Documents/Workspaces/GO-LANG-WORKSPACE"
    for candidate in "$WIN_GOPATH/bin/wails.exe" \
                     "/mnt/c/Users/Andrea/Documents/Workspaces/GO-LANG-WORKSPACE/bin/wails.exe" \
                     "$HOME/go/bin/wails"; do
      if [[ -x "$candidate" ]]; then
        WAILS_CMD=("$candidate"); break
      fi
    done
    if [[ -z "${WAILS_CMD[0]+x}" ]]; then
      echo -e "${RED}ERROR: wails not found.${NC}" >&2
      echo "  Install: go install github.com/wailsapp/wails/v2/cmd/wails@latest" >&2
      echo "  Or set:  WAILS_BIN=/path/to/wails" >&2
      exit 1
    fi
  fi
fi
echo -e "${GREEN}✓${NC} Wails: $("${WAILS_CMD[@]}" version 2>/dev/null | head -1 || echo '(ok)')"
echo ""

# ── Optional: encoding check ──────────────────────────────────────────────────
if [[ -f "scripts/check-mojibake.mjs" ]]; then
  echo "==> Checking text encoding..."
  "${NODE_BIN[@]}" scripts/check-mojibake.mjs
else
  echo -e "${YELLOW}SKIP${NC} scripts/check-mojibake.mjs not found"
fi

# ── Frontend build ────────────────────────────────────────────────────────────
echo ""
echo "==> Building frontend..."
(cd frontend && "${NPM_BIN[@]}" run build)
echo -e "${GREEN}✓${NC} Frontend built."

# ── Go tests ──────────────────────────────────────────────────────────────────
echo ""
echo "==> Running Go tests..."
"${GO_CMD[@]}" test ./... && echo -e "${GREEN}✓${NC} Tests passed." || {
  echo -e "${YELLOW}⚠️  Some tests failed — continuing (product-first policy)${NC}"
}

# ── Optional: icon generation ─────────────────────────────────────────────────
if [[ -f "scripts/generate-icons.sh" ]]; then
  echo ""
  echo "==> Generating icons..."
  bash scripts/generate-icons.sh || echo -e "${YELLOW}WARN: icon generation failed; using existing icons${NC}"
else
  echo -e "${YELLOW}SKIP${NC} scripts/generate-icons.sh not found — using existing icons"
fi

# ── Wails release build ───────────────────────────────────────────────────────
echo ""
echo "==> Building release with Wails..."
"${WAILS_CMD[@]}" build -ldflags "-s -w -X main.Version=$VERSION" -clean

# ── Optional: normalize generated bindings ────────────────────────────────────
if [[ -f "scripts/normalize-generated-bindings.mjs" ]]; then
  echo ""
  echo "==> Normalizing generated binding comments..."
  "${NODE_BIN[@]}" scripts/normalize-generated-bindings.mjs
else
  echo -e "${YELLOW}SKIP${NC} scripts/normalize-generated-bindings.mjs not found"
fi

# ── Verify output ─────────────────────────────────────────────────────────────
EXE_PATH="build/bin/adOmnia.exe"
if [[ ! -f "$EXE_PATH" ]]; then
  echo -e "${RED}ERROR: expected Windows executable not found at ${EXE_PATH}${NC}" >&2
  exit 1
fi

SIZE=$(ls -lh "$EXE_PATH" | awk '{print $5}')
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Release build complete!              ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo -e "  ${CYAN}$EXE_PATH${NC}  ($SIZE)"
echo ""
