#!/usr/bin/env bash
# Compatibility entrypoint for the Wails 3 Linux native package.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$ROOT_DIR/build/linux/package-native-tarballs.sh" "${1:-dev}"
