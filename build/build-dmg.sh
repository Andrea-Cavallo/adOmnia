#!/usr/bin/env bash
# Compatibility entrypoint. The canonical macOS release build lives in scripts/.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT_DIR/scripts/build-macos.sh" "${1:-dev}"
