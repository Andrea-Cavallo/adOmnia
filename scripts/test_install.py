"""Offline integration checks: python3 -m unittest discover -s scripts -p test_install.py."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).with_name('install.sh').resolve()
BASE = 'https://github.com/Andrea-Cavallo/adOmnia/releases/download/v1.2.3/'
NAME = 'adomnia-1.2.3-linux-amd64-update.zip'


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.target = self.root / 'apps' / 'adomnia'
        self.target.parent.mkdir()
        self.target.write_text('old app')
        self.package = self.root / 'package.zip'
        with zipfile.ZipFile(self.package, 'w') as z:
            z.writestr('adomnia', 'new app')
        self.sums = self.root / 'sums'
        self.checksum()
        release = {'tag_name': 'v1.2.3', 'assets': [
            {'name': name, 'browser_download_url': BASE + name}
            for name in (NAME, 'SHA256SUMS.txt')]}
        (self.root / 'release').write_text(json.dumps(release))
        # Explicit platform/architecture; avoid depending on host architecture.
        self.mock('uname', 'if [[ "$1" == -s ]]; then echo Linux; else echo x86_64; fi\n')
        self.mock('pgrep', 'exit 1\n')
        self.mock('curl', '''url=''; out=''
while (($#)); do
 if [[ "$1" == -o ]]; then out="$2"; shift 2
 else [[ "$1" == https:* ]] && url="$1"; shift
 fi
done
case "$url" in
 https://api.github.com/*) cp "$FIXTURE/release" "$out" ;;
 */SHA256SUMS.txt) cp "$FIXTURE/sums" "$out" ;;
 *-update.zip) cp "$FIXTURE/package.zip" "$out" ;;
 *) exit 1 ;;
esac
''')
        self.env = {**os.environ, 'PATH': str(self.bin) + ':' + os.environ['PATH'], 'FIXTURE': str(self.root)}

    def mock(self, name, body):
        path = self.bin / name
        path.write_text('#!/usr/bin/env bash\n' + body)
        path.chmod(0o755)

    def checksum(self):
        self.sums.write_text(hashlib.sha256(self.package.read_bytes()).hexdigest() + '  ' + NAME + '\n')

    def run_script(self, *args, consent=''):
        return subprocess.run(['bash', str(SCRIPT), '--destination', str(self.target), *args],
                              input=consent, text=True, capture_output=True, env=self.env)

    def test_install_retains_previous_copy(self):
        result = self.run_script('--yes', '--version', 'v1.2.3')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.target.read_text(), 'new app')
        self.assertEqual(Path(str(self.target) + '.adomnia-previous').read_text(), 'old app')
        self.assertNotEqual(self.run_script('--yes').returncode, 0)

    def test_declining_leaves_application_unchanged(self):
        self.assertEqual(self.run_script(consent='n\n').returncode, 0)
        self.assertEqual(self.target.read_text(), 'old app')

    def test_bad_checksum_never_replaces_application(self):
        self.sums.write_text('0' * 64 + '  ' + NAME + '\n')
        self.assertNotEqual(self.run_script('--yes').returncode, 0)
        self.assertEqual(self.target.read_text(), 'old app')

    def test_traversal_archive_rejected(self):
        with zipfile.ZipFile(self.package, 'w') as z:
            z.writestr('../escaped', 'unsafe')
        self.checksum()
        self.assertNotEqual(self.run_script('--yes').returncode, 0)
        self.assertEqual(self.target.read_text(), 'old app')


if __name__ == '__main__':
    unittest.main()
