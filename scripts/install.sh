#!/usr/bin/env bash
# Install or update a user-owned copy. Never modifies settings/workspaces.
set -euo pipefail
repo='Andrea-Cavallo/adOmnia'
version='latest'
yes=false
case "$(uname -s)" in
  Linux) platform=linux; destination="${HOME}/.local/bin/adomnia"; entry=adomnia
    [[ "$(uname -m)" == x86_64 ]] || { echo 'Only Linux x86_64 releases are available.' >&2; exit 1; } ;;
  Darwin) platform=macos; destination="${HOME}/Applications/adomnia.app"; entry=adomnia.app ;;
  *) echo 'Use install.ps1 on Windows.' >&2; exit 1 ;;
esac
while (($#)); do
  case "$1" in
    --version) version="${2:?Missing version}"; shift 2 ;;
    --destination) destination="${2:?Missing destination}"; shift 2 ;;
    --yes) yes=true; shift ;;
    *) echo 'Usage: bash install.sh [--version vX.Y.Z] [--destination PATH] [--yes]' >&2; exit 1 ;;
  esac
done
[[ "$version" == latest || "$version" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([-+][A-Za-z0-9.-]+)?$ ]] || { echo 'Invalid release version.' >&2; exit 1; }
for tool in curl python3 unzip; do command -v "$tool" >/dev/null || { echo "Required tool: $tool" >&2; exit 1; }; done
command -v pgrep >/dev/null || { echo 'Required tool: pgrep' >&2; exit 1; }
if pgrep -x adomnia >/dev/null; then echo 'Close adOmnia before running this script.' >&2; exit 1; fi
[[ "$destination" == /* && ! -L "$destination" ]] || { echo 'Destination must be an absolute, non-symlink path.' >&2; exit 1; }
case "$destination" in /usr/*|/opt/*|/snap/*) echo 'Use the package manager for system installations.' >&2; exit 1 ;; esac
[[ ! -e "$destination.adomnia-previous" ]] || { echo 'A previous backup exists; review it before updating again.' >&2; exit 1; }
work=$(mktemp -d)
stage=''
cleanup() { rm -rf "$work"; if [[ -n "$stage" ]]; then rm -rf "$stage"; fi; }
trap cleanup EXIT
fetch() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --connect-timeout 15 --max-time 1200 "$1" -o "$2"; }
endpoint="https://api.github.com/repos/$repo/releases/latest"
if [[ "$version" != latest ]]; then
  [[ "$version" == v* ]] || version="v$version"
  endpoint="https://api.github.com/repos/$repo/releases/tags/$version"
fi
fetch "$endpoint" "$work/release.json"
# Select only official release assets, not arbitrary URLs from input.
python3 - "$work" "$platform" <<'PY'
import json, pathlib, sys
root = pathlib.Path(sys.argv[1]); platform = sys.argv[2]
r = json.loads((root / 'release.json').read_text())
suffix = '-linux-amd64-update.zip' if platform == 'linux' else '-macos-universal-update.zip'
assets = r.get('assets', [])
for key, match in [('package', lambda n: n.endswith(suffix)), ('checksums', lambda n: n == 'SHA256SUMS.txt')]:
    found = [a for a in assets if match(a['name'])]
    if len(found) != 1: raise SystemExit('Release does not contain the required package/checksums.')
    a = found[0]
    prefix = 'https://github.com/Andrea-Cavallo/adOmnia/releases/download/'
    if not a['browser_download_url'].startswith(prefix): raise SystemExit('Untrusted asset URL.')
    (root / (key + '.url')).write_text(a['browser_download_url'])
    if key == 'package': (root / 'name').write_text(a['name'])
print('Release:', r['tag_name'])
PY
printf 'Install at %s (existing copy will be backed up).\n' "$destination"
if ! $yes; then
  read -r -p 'Download and install? [y/N] ' consent
  [[ "$consent" == y || "$consent" == Y ]] || exit 0
fi
fetch "$(<"$work/package.url")" "$work/package.zip"
fetch "$(<"$work/checksums.url")" "$work/SHA256SUMS.txt"
python3 - "$work" <<'PY'
import hashlib, pathlib, sys
root = pathlib.Path(sys.argv[1]); name = (root / 'name').read_text()
expected = [line.split()[0] for line in (root / 'SHA256SUMS.txt').read_text().splitlines()
            if len(line.split()) == 2 and line.split()[1].lstrip('*') == name]
h = hashlib.sha256()
with (root / 'package.zip').open('rb') as f:
    for block in iter(lambda: f.read(1024 * 1024), b''): h.update(block)
if len(expected) != 1 or h.hexdigest() != expected[0].lower(): raise SystemExit('Checksum rejected; nothing installed.')
# Reject traversal and symlink entries before unzip.
import zipfile, stat
with zipfile.ZipFile(root / 'package.zip') as z:
    for item in z.infolist():
        p = pathlib.PurePosixPath(item.filename)
        if p.is_absolute() or '..' in p.parts or '\\' in item.filename or stat.S_ISLNK(item.external_attr >> 16):
            raise SystemExit('Unsafe archive entry.')
PY
mkdir -p "$(dirname "$destination")"
stage=$(mktemp -d "$(dirname "$destination")/.adomnia-install-XXXXXX")
unzip -q "$work/package.zip" -d "$stage"
[[ -e "$stage/$entry" ]] || { echo 'Application missing in package.' >&2; exit 1; }
if [[ "$platform" == macos ]]; then
  /usr/bin/codesign --verify --deep --strict "$stage/$entry"
else
  chmod 755 "$stage/$entry"
fi
if [[ -e "$destination" ]]; then mv "$destination" "$destination.adomnia-previous"; fi
if ! mv "$stage/$entry" "$destination"; then
  if [[ -e "$destination.adomnia-previous" ]]; then mv "$destination.adomnia-previous" "$destination"; fi
  exit 1
fi
printf 'Installed: %s\n' "$destination"
echo 'Launch adOmnia to verify it. Any previous copy is retained at PATH.adomnia-previous; remove it only after verification.'
