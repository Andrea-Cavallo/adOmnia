#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v node >/dev/null 2>&1; then
  NODE_BIN=(node)
elif [[ -x "/mnt/c/Program Files/nodejs/node.exe" ]]; then
  NODE_BIN=("/mnt/c/Program Files/nodejs/node.exe")
else
  echo "ERROR: node not found" >&2
  exit 1
fi

if command -v npm >/dev/null 2>&1; then
  NPM_BIN=(npm)
elif [[ -f "/mnt/c/Program Files/nodejs/node_modules/npm/bin/npm-cli.js" ]]; then
  NPM_BIN=("${NODE_BIN[@]}" "/mnt/c/Program Files/nodejs/node_modules/npm/bin/npm-cli.js")
else
  echo "ERROR: npm not found" >&2
  exit 1
fi

if [[ -x "/mnt/c/Program Files/Go/bin/go.exe" ]]; then
  GO_BIN=("/mnt/c/Program Files/Go/bin/go.exe")
elif command -v go >/dev/null 2>&1; then
  GO_BIN=(go)
else
  echo "ERROR: go not found" >&2
  exit 1
fi

echo "==> Checking text encoding"
"${NODE_BIN[@]}" scripts/check-mojibake.mjs

echo "==> Building frontend"
(cd frontend && "${NPM_BIN[@]}" run build)

echo "==> Running Go tests"
"${GO_BIN[@]}" test ./...

echo "==> Generating icons when possible"
if [[ -x scripts/generate-icons.sh ]]; then
  scripts/generate-icons.sh || echo "WARN: icon generation failed; continuing with existing icons"
else
  bash scripts/generate-icons.sh || echo "WARN: icon generation failed; continuing with existing icons"
fi

if [[ -n "${WAILS_BIN:-}" ]]; then
  WAILS_CMD=("$WAILS_BIN")
elif command -v wails >/dev/null 2>&1; then
  WAILS_CMD=(wails)
else
  echo "ERROR: wails not found. Set WAILS_BIN=/path/to/wails." >&2
  exit 1
fi

echo "==> Building release with ${WAILS_CMD[*]}"
"${WAILS_CMD[@]}" build

echo "==> Normalizing generated binding comments"
"${NODE_BIN[@]}" scripts/normalize-generated-bindings.mjs

echo "==> Re-checking text encoding after Wails generation"
"${NODE_BIN[@]}" scripts/check-mojibake.mjs

EXE_PATH="build/bin/adOmnia.exe"
if [[ ! -f "$EXE_PATH" ]]; then
  echo "ERROR: expected Windows executable not found at ${EXE_PATH}" >&2
  exit 1
fi

echo "==> Release executable created: ${EXE_PATH}"
