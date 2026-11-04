# Desktop acceptance checklist

The manual checks that decide whether a desktop release is accepted. Automated
suites prove the code paths; they never replace a run in the real window, and no
row here may be closed because the equivalent test is green.

Record each run in the evidence table of [ISSUES.md](ISSUES.md) with date,
platform, version and what was actually observed. "Not run" is a valid, useful
state: a missing measurement is never zero.

## Status

| Area | Platform | State |
|---|---|---|
| Installer: clean install, in-place upgrade, uninstall, in-app update | Windows 11, 1.0.24 (2026-11-04) | Passed |
| Installer: WebView2 missing | Windows | Not run |
| Portable build and its in-app update | Windows | Not run |
| Update: Save & restart, Install on exit, Later, Postpone | Windows | Install on exit / in-app update observed; the rest not recorded |
| Update: rollback when the new build does not confirm startup | Windows | Not run |
| Crash recovery: unsaved buffers, multiple projects reopened | Any | Not run |
| Functional smoke: startup, terminal, Run, Test, Debug, teardown | macOS | Not run (nothing has run on macOS) |
| Functional smoke: startup, terminal, Run, Test, Debug, teardown | Linux | Not run |
| Single instance: second launch during shutdown | Windows | Not run (known open case, `docs/performance/runtime-2026-10-25.md`) |

## Windows installer

Prerequisite: a release build from the tag under test
(`adomnia-<version>-windows-amd64-setup.exe`) and a Windows account that is **not**
elevated.

1. **Clean install.** Run the setup. Expected: no UAC prompt, install in
   `%LOCALAPPDATA%\Programs\adOmnia`, Start menu entry, entry in **Settings → Apps**
   with the version, optional desktop shortcut. Launch the app from the Start menu.
2. **In-place upgrade.** Create a workspace, a collection and a non-default setting.
   Run the setup of a newer build over the installed copy. Expected: the setup asks
   to close adOmnia if it is running, keeps workspaces/collections/settings, and the
   version shown in **Settings → Apps** and **Settings → About** matches the tag.
3. **WebView2 missing.** On a machine (or VM) without the Evergreen runtime, run the
   setup. Expected: the setup explains the requirement and offers Microsoft's
   download; the app does not start to a blank window.
4. **Portable.** Copy `adomnia-<version>-windows-amd64.exe` into a writable folder,
   start it, then use **Settings → Check for updates**. Expected: the update replaces
   that executable in place and the version in About changes after the restart.
5. **Uninstall.** Run the uninstaller twice: once keeping the data, once ticking
   **Also delete my data**. Expected: application and shortcuts removed; with the
   default option workspaces, collections and settings are still there after a
   reinstall; with the option they are gone. Silent mode: `/S`.

## Updates inside the app

Prerequisite: an installed build that trusts the release signing key, and a newer
signed release.

1. **Save & restart** with a workspace open. Expected: the app restarts into the new
   version, the workspace is restored, and the previous executable is gone once the
   new build confirms startup.
2. **Install on exit** (enabled). Expected: closing the app installs and the next
   start is the new version; **Postpone update** turns the setting off.
3. **Later.** Expected: nothing changes, no restart, the notice stays available.
4. **Rollback.** Interrupt the new build before it opens its window (kill it during
   the restart). Expected: the updater restores the previous version and starts it;
   the failure reason is visible, and no half-updated file remains.
5. **Read-only location.** Copy the app to `/usr`, `C:\Program Files` or a package
   manager path. Expected: the update is not offered as an in-place install; the
   notice links to the release.

## Crash recovery

1. Open two projects, edit files without saving in both, then kill the process
   (`Stop-Process -Name adomnia -Force`).
2. Start the app again. Expected: both projects reopen with their unsaved buffers
   restored, no buffer is silently dropped, and the layout is not reset.
3. Repeat with a normal quit: unsaved buffers must follow the documented save prompt,
   not the crash path.

## macOS and Linux functional smoke

Prerequisite: a build from the tag under test on the target OS.

1. Start the app, open a project, open the terminal and run a command.
2. Run, Test and Debug a small project of the language the platform supports, then
   stop everything.
3. Close the app. Expected: no `adomnia`, language server, debug adapter or child
   process survives; the process tree check is the same one used for Windows.
4. Install and uninstall with `install.sh` / `uninstall.sh` where the release ships
   them; workspaces and settings survive the uninstall.

## Process cleanup after any workflow

After Run, Test, Debug and terminal use, close the app and check the process tree.
Expected: no `gopls`, `dlv`/`debugpy`/CodeLLDB, no orphaned shell, no
language-server process owned by a closed window. Use the in-app resource monitor
during the session and the OS process list after it.

## Recording a run

Add one row per area to [ISSUES.md](ISSUES.md): date, platform and version, what was
checked, the result, and what could not be observed (for example whether WebView2 was
already present). A failed step becomes a numbered issue with the exact command,
message and log line; do not soften the wording to "works with caveats" without
naming the caveat.
