"""Offline tarball installer checks: python3 -B -m unittest discover -s build/linux."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parent


class UserInstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.package = self.root / 'package'
        self.package.mkdir()
        for src, dst in [('install.sh', 'install.sh'), ('uninstall.sh', 'uninstall.sh'),
                         ('adOmnia.desktop', 'adomnia.desktop')]:
            shutil.copyfile(SOURCE / src, self.package / dst)
        (self.package / 'adomnia').write_text('#!/bin/sh\nexit 0\n')
        (self.package / 'adomnia.png').write_bytes(b'fallback')
        icons = self.package / 'icons'
        icons.mkdir()
        (icons / 'adOmnia_32x32.png').write_bytes(b'icon')
        (icons / 'adomnia-symbolic.svg').write_text('<svg/>')
        self.home = self.root / 'user home'
        self.home.mkdir()
        self.tools = self.root / 'tools'
        self.tools.mkdir()
        for name in ['gtk-update-icon-cache', 'xdg-icon-resource', 'update-desktop-database']:
            self.mock(name, 'exit 0')
        self.mock('id', 'echo 1000')
        self.env = {**os.environ, 'HOME': str(self.home),
                    'PATH': str(self.tools) + ':' + os.environ['PATH']}
        self.env.pop('XDG_DATA_HOME', None)

    def mock(self, name, body):
        path = self.tools / name
        path.write_text('#!/bin/sh\n' + body + '\n')
        path.chmod(0o755)

    def run_script(self, name):
        return subprocess.run(['bash', str(self.package / name)], env=self.env,
                              text=True, capture_output=True)

    def install(self):
        result = self.run_script('install.sh')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_install_and_uninstall_preserve_data_and_other_binaries(self):
        data = self.home / '.local/share'
        self.install()
        exe = self.home / '.local/bin/adomnia'
        self.assertTrue(os.access(exe, os.X_OK))
        desktop = (data / 'applications/adomnia.desktop').read_text()
        self.assertIn(f'Exec="{exe}"', desktop)
        self.assertNotIn('/opt/', desktop)
        self.assertEqual((data / 'icons/hicolor/32x32/apps/adomnia.png').read_bytes(), b'icon')
        workspace = data / 'adomnia/workspace.json'
        workspace.write_text('user data')
        other = exe.with_name('other-tool')
        other.write_text('unrelated')
        self.install()  # Reinstallation must not touch data.
        result = self.run_script('uninstall.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(exe.exists())
        self.assertFalse((data / 'applications/adomnia.desktop').exists())
        self.assertFalse((data / 'icons/hicolor/32x32/apps/adomnia.png').exists())
        self.assertEqual(workspace.read_text(), 'user data')
        self.assertEqual(other.read_text(), 'unrelated')

    def test_custom_xdg_data_home(self):
        data = self.root / 'custom data'
        self.env['XDG_DATA_HOME'] = str(data)
        self.install()
        self.assertTrue((data / 'applications/adomnia.desktop').exists())
        self.assertFalse((self.home / '.local/share/applications/adomnia.desktop').exists())

    def test_root_and_relative_xdg_paths_are_rejected(self):
        self.mock('id', 'echo 0')
        for script in ['install.sh', 'uninstall.sh']:
            self.assertNotEqual(self.run_script(script).returncode, 0)
        self.mock('id', 'echo 1000')
        self.env['XDG_DATA_HOME'] = 'relative'
        for script in ['install.sh', 'uninstall.sh']:
            self.assertNotEqual(self.run_script(script).returncode, 0)
        self.assertFalse((self.home / '.local/bin/adomnia').exists())


if __name__ == '__main__':
    unittest.main()
